// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/*
 * ═══════════════════════════════════════════════════════════════════════
 * ZKBOARD - ANONYMOUS MESSAGE BOARD WITH RELAY NETWORK
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Questo contratto implementa una bacheca messaggi anonima utilizzando
 * Zero-Knowledge Proofs (Semaphore Protocol) con un sistema di relay
 * decentralizzato per garantire massima privacy.
 *
 * CARATTERISTICHE PRINCIPALI:
 * 1. Identità anonime: Gli utenti si registrano con un "identity commitment"
 *    che non rivela la loro vera identità Semaphore
 * 2. Sistema di depositi: Gli utenti depositano ETH per poter postare messaggi
 *    (messaggi disponibili = deposits / COST_PER_MESSAGE)
 * 3. Relay Network: I messaggi possono essere postati tramite relayers terzi
 *    che ricevono una fee per eseguire le transazioni
 * 4. Direct Posting: Gli utenti possono anche postare direttamente
 * 5. Proof ZK: Ogni messaggio richiede una proof che dimostra membership
 *    nel gruppo senza rivelare quale identity commitment l'ha generata
 * 6. Nullifier: Previene il double-posting usando hash univoci
 *
 * NOTA IMPORTANTE SULLA PRIVACY:
 * L'indirizzo Ethereum usato per le transazioni è SEMPRE visibile on-chain.
 * La privacy garantita da Semaphore riguarda solo l'identity commitment,
 * NON l'indirizzo Ethereum del wallet.
 *
 * FLUSSO OPERATIVO:
 * 1. Utente deposita ETH → Può postare (deposits / COST_PER_MESSAGE) messaggi
 * 2. Utente genera ZK proof offline (nel browser)
 * 3a. DIRECT: Utente posta direttamente (1 transazione)
 * 3b. RELAY: Utente crea relay request, relayer la esegue (2 transazioni)
 * 4. Il deposito viene scalato ad ogni messaggio
 *
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * @title ISemaphore
 * @notice Interfaccia per il contratto Semaphore v3
 * @dev Questa interfaccia è compatibile con la versione 3 di Semaphore
 *      deployata su Sepolia. La v3 ha signature diverse dalla v4, in
 *      particolare verifyProof() non restituisce bool ma fa revert se fallisce
 */
interface ISemaphore {
    /**
     * @notice Crea un nuovo gruppo Semaphore
     * @param groupId ID univoco del gruppo
     * @param depth Profondità del Merkle tree (determina il max numero di membri)
     * @param admin Indirizzo dell'amministratore del gruppo (solo lui può aggiungere membri)
     */
    function createGroup(uint256 groupId, uint256 depth, address admin) external;

    /**
     * @notice Aggiunge un membro al gruppo
     * @param groupId ID del gruppo
     * @param identityCommitment Commitment dell'identità da aggiungere
     * @dev Solo l'admin del gruppo può chiamare questa funzione
     */
    function addMember(uint256 groupId, uint256 identityCommitment) external;

    /**
     * @notice Verifica una Zero-Knowledge Proof
     * @param groupId ID del gruppo
     * @param merkleTreeRoot Root corrente del Merkle tree
     * @param signal Messaggio/segnale da verificare (hash del messaggio)
     * @param nullifierHash Hash del nullifier (univoco per identità+segnale)
     * @param externalNullifier Valore esterno per variare il nullifier
     * @param proof Array di 8 elementi che costituiscono la proof Groth16
     * @dev IMPORTANTE: In Semaphore v3 questa funzione NON restituisce bool
     *      ma fa REVERT se la proof non è valida. Questo è diverso dalla v4.
     */
    function verifyProof(
        uint256 groupId,
        uint256 merkleTreeRoot,
        uint256 signal,
        uint256 nullifierHash,
        uint256 externalNullifier,
        uint256[8] calldata proof
    ) external;
}

/**
 * @title ZKBoard
 * @author ZKBoard Team
 * @notice Bacheca messaggi anonima con sistema relay decentralizzato
 * @dev Implementa il pattern deposit-based per incentivare i relayers
 */
contract ZKBoard {
    // ═════════════════════════════════════════════════════════════════
    // STATE VARIABLES - CORE
    // ═════════════════════════════════════════════════════════════════

    /// @notice Riferimento al contratto Semaphore per gestire gruppi e proofs
    ISemaphore public semaphore;

    /// @notice ID del gruppo Semaphore usato da questa board
    /// @dev Ogni board ha il suo gruppo isolato
    uint256 public groupId;

    // ═════════════════════════════════════════════════════════════════
    // STATE VARIABLES - RELAY SYSTEM
    // ═════════════════════════════════════════════════════════════════

    // Questa parte di codice definisce tutto lo stato (le variabili presenti on-chain) che
    // serve per far funzionare il sistema depositi -> richieste -> relayer
    
    // In Solidity il mapping è una struttura dati di tipo dizionario : si associa una chiave a un valore

    /// @notice Depositi degli utenti (in wei)
    /// @dev address => amount in ETH depositato
    ///      Questo mapping traccia quanto ETH ha depositato ogni utente
    ///      Il deposito serve a pagare i messaggi e le fee ai relayers
    ///      Messaggi disponibili = deposits / COST_PER_MESSAGE
    mapping(address => uint256) public deposits;  // Per ogni address (chiave) salvo un uint256 (valore) che rappresenta il deposito

    /**
     * @notice Struttura dati per una richiesta di relay
     * @dev Contiene tutti i dati necessari per eseguire il posting anonimo
     */
    struct RelayRequest {
        /// @notice Root del Merkle tree al momento della generazione proof
        /// @dev Serve per verificare che l'identità era nel gruppo in quel momento
        uint256 merkleTreeRoot;  // root del MerkleTree del gruppo semaphore nel momento in cui l'utente ha generato la proof. Semaphore verifica la
        			 // membership rispetto a una root specifica

        /// @notice Hash del nullifier per prevenire double-posting
        /// @dev È derivato da: hash(identityNullifier, externalNullifier)
        ///      Ogni identità può usare un nullifier una sola volta
        uint256 nullifierHash;  // è l'ID univoco anti-riuso che serve a impedire che la stessa identità ricicli la stessa prova o lo stesso contesto

        /// @notice Array di 8 elementi che costituiscono la proof Groth16
        /// @dev Formato: [pi_a.x, pi_a.y, pi_b.x[0], pi_b.x[1], pi_b.y[0], pi_b.y[1], pi_c.x, pi_c.y]
        uint256[8] proof;  // proof che semaphore verifica

        /// @notice Testo del messaggio da postare
        string message;

        /// @notice Fee da pagare al relayer (in wei)
        /// @dev Più alta è la fee, più velocemente verrà eseguita la request
        uint256 relayFee;  // fee da pagare al relayer per eseguire la request

        /// @notice Indirizzo di chi ha creato la request (per tracking e payment)
        /// @dev Questo NON viene esposto pubblicamente nel messaggio finale
        address requester;  // Indirizzo di chi ha creato la request. Serve per sapere da chi scalare il deposito quando si paga il relayer

        /// @notice Flag che indica se la request è stata eseguita
        /// @dev Previene double-execution della stessa request
        bool executed;  // Una volta eseguita, la request viene marcata come true

        /// @notice Indice usato come externalNullifier per questa proof
        /// @dev Permette alla stessa identità di postare messaggi multipli
        uint256 messageIndex;
    }

    /// @notice Mapping di tutte le relay requests
    /// @dev requestId => RelayRequest struct
    mapping(uint256 => RelayRequest) public relayRequests;  // Creo una tabella chiave - valore per tenere traccia di tutte le relayRequests
    // Ogni relayRequest che viene fatta viene salvata in storage nello smart contract e quindi vengono registrate on-chain

    /// @notice Contatore incrementale per generare ID univoci
    /// @dev Ogni nuova request riceve nextRequestId, poi viene incrementato
    uint256 public nextRequestId;

    /// @notice Contatore globale per generare externalNullifier univoci
    /// @dev Incrementato ad ogni messaggio, usato come externalNullifier
    ///      per permettere alla stessa identità di postare più messaggi
    uint256 public messageCounter;

    /// @notice Deposito minimo richiesto per unirsi (0.05 ETH)
    /// @dev Equivale a circa 50 messaggi con il costo attuale
    uint256 public constant MIN_DEPOSIT = 0.05 ether;

    /// @notice Costo di un singolo messaggio (0.001 ETH)
    /// @dev Usato per calcolare messaggi disponibili: deposits / COST_PER_MESSAGE
    ///      Scalato dal deposito ad ogni messaggio inviato
    uint256 public constant COST_PER_MESSAGE = 0.001 ether;

    // ═════════════════════════════════════════════════════════════════
    // STATE VARIABLES - NULLIFIER TRACKING
    // ═════════════════════════════════════════════════════════════════

    /// @notice Traccia quali nullifier sono già stati usati
    /// @dev nullifierHash => bool (true = già usato)
    ///      Previene che la stessa proof venga riusata per postare più messaggi
    mapping(uint256 => bool) public nullifierHashes;

    /// @notice Numero totale di messaggi postati con successo
    /// @dev Incrementato ogni volta che executeRelay() o postMessageDirect() ha successo
    uint256 public messageCount;

    /// @notice Flag che indica se il contratto è stato inizializzato
    /// @dev Previene chiamate multiple a initializeBoard()
    ///
    /// PERCHÉ NECESSARIO:
    /// Senza questa protezione, chiunque potrebbe chiamare initializeBoard()
    /// multiple volte, causando potenziali problemi:
    /// - Creazione di gruppi duplicati con lo stesso groupId
    /// - Corruzione dello stato del contratto Semaphore
    /// - Possibili exploit se la creazione del gruppo fallisce
    ///
    /// TIPO DI VARIABILE:
    /// - private: Non accessibile dall'esterno (a differenza di public)
    /// - bool: false di default al deploy, diventa true dopo prima chiamata
    ///
    /// PATTERN:
    /// Questo è il pattern "Initialization Guard" standard per contratti Solidity.
    /// Simile al modifier "initializer" di OpenZeppelin, ma implementato manualmente.
    bool private initialized;

    // ═════════════════════════════════════════════════════════════════
    // EVENTS
    // ═════════════════════════════════════════════════════════════════

    // Un evento in Solidity è un meccanismo per scrivere log nella blockchain quando succede qualcosa in un contratto.
    // Non cambia lo stato del contratto, non modifica storage. Serve per far sapere al mondo esterno che è successo qualcosa.
    // Pensato per il frontend

    /// @notice Emesso quando un utente fa un deposito
    event DepositMade(address indexed user, uint256 amount, uint256 newBalance);

    /// @notice Emesso quando viene creata una relay request
    event RelayRequestCreated(uint256 indexed requestId, address indexed requester, uint256 relayFee);

    /// @notice Emesso quando una relay request viene eseguita
    event MessageRelayed(uint256 indexed requestId, address indexed relayer, uint256 fee);

    /// @notice Emesso quando un utente ritira il suo deposito
    event DepositWithdrawn(address indexed user, uint256 amount);

    /// @notice Emesso quando viene creato il gruppo Semaphore
    event GroupCreated(uint256 groupId);

    /// @notice Emesso quando un nuovo membro si unisce al gruppo
    event MemberJoined(uint256 identityCommitment);

    /// @notice Emesso quando viene postato un messaggio
    /// @dev Questo è l'evento principale che il frontend ascolta per mostrare i messaggi
    event MessagePosted(
        bytes32 indexed contentHash,  // Hash del messaggio (per identificarlo univocamente)
        string message,                // Testo del messaggio
        uint256 timestamp,             // Quando è stato postato
        uint256 messageId              // ID incrementale del messaggio
    );

    // ═════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═════════════════════════════════════════════════════════════════

    // Questo è il costruttore del contratto, ovvero la funzione che viene eseguita una sola volta nel momento in cui viene fatto il deploy del contratto

    /**
     * @notice Costruttore del contratto ZKBoard
     * @param _semaphoreAddress Indirizzo del contratto Semaphore deployato
     * @param _groupId ID univoco per il gruppo di questa board
     * @dev Il gruppo non viene creato qui, ma in initializeBoard()
     *      Questo permette di verificare il deploy prima di creare il gruppo
     */
    constructor(address _semaphoreAddress, uint256 _groupId) {
        // Salva il riferimento al contratto Semaphore
        semaphore = ISemaphore(_semaphoreAddress);  //_semaphoreAddress è l'indirizzo on-chain del contratto semaphore già deployato on-chain. Faccio un cast

        // Salva l'ID del gruppo che questa board userà
        groupId = _groupId;
    }

    // ═════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═════════════════════════════════════════════════════════════════

    /**
     * @notice Inizializza il gruppo Semaphore
     * @dev Deve essere chiamato UNA SOLA VOLTA dopo il deploy
     *      Crea il gruppo nel contratto Semaphore con questo contratto come admin
     *
     * PERCHÉ SEPARATO DAL CONSTRUCTOR?
     * - Permette di verificare che il deploy sia corretto prima di creare il gruppo
     * - Se il constructor fallisse a metà, avremmo un gruppo inconsistente
     * - Questa separazione è una best practice per deploy complessi
     */
    function initializeBoard() external {
        // ═════════════════════════════════════════════════════════════════
        // PROTEZIONE CONTRO INIZIALIZZAZIONE MULTIPLA
        // ═════════════════════════════════════════════════════════════════

        // STEP 1: Verifica che il contratto non sia già stato inizializzato
        //
        // COME FUNZIONA:
        // - Al deploy, initialized = false (valore default per bool)
        // - Alla prima chiamata: !initialized = !false = true → passa il check
        // - Alle chiamate successive: !initialized = !true = false → REVERT
        //
        // PERCHÉ È IMPORTANTE:
        // Previene che utenti malintenzionati chiamino questa funzione più volte,
        // che potrebbe causare:
        // 1. Tentativi di creare gruppi duplicati (il contratto Semaphore farebbe revert)
        // 2. Spreco di gas in transazioni che fallirebbero
        // 3. Potenziali vulnerabilità se il contratto Semaphore non gestisce bene i duplicati
        //
        // MESSAGGIO DI ERRORE:
        require(!initialized, "Board gia inizializzata");  // Faccio un controllo e se non passa blocca l'esecuzione della funzione

        // STEP 2: Marca il contratto come inizializzato
        //
        // ORDINE IMPORTANTE (Checks-Effects-Interactions):
        // Settiamo initialized = true PRIMA di chiamare createGroup().
        // Questo previene reentrancy attacks: anche se createGroup() potesse
        // richiamare questo contratto, il require sopra farebbe revert.
        //
        // IRREVERSIBILE:
        // Una volta settato a true, NON può mai tornare false.
        // Il contratto può essere inizializzato UNA SOLA VOLTA per sempre.
        initialized = true;

        // ═════════════════════════════════════════════════════════════════
        // CONFIGURAZIONE GRUPPO SEMAPHORE
        // ═════════════════════════════════════════════════════════════════

        // Depth 20 = max 2^20 = ~1 milione di membri possibili
        // Questo è un buon compromesso tra capacità e gas cost
        uint256 depth = 20;

        // Crea il gruppo nel contratto Semaphore
        // address(this) = questo contratto diventa l'admin del gruppo
        // Solo l'admin può aggiungere nuovi membri
        semaphore.createGroup(groupId, depth, address(this));

        // Emetti evento per tracking
        emit GroupCreated(groupId);
    }

    // ═════════════════════════════════════════════════════════════════
    // CORE RELAY FUNCTIONS
    // ═════════════════════════════════════════════════════════════════

    /**
     * @notice Unisciti al gruppo depositando ETH
     * @param identityCommitment Commitment dell'identità Semaphore generata dal client
     *
     * FLUSSO:
     * 1. Utente genera identità nel browser (privata, mai inviata on-chain)
     * 2. Deriva il commitment: poseidon([nullifier, trapdoor])
     * 3. Chiama questa funzione con il commitment + deposito ETH
     * 4. Viene aggiunto al gruppo Semaphore
     * 5. Può postare messaggi (deposits / COST_PER_MESSAGE)
     *
     * ESEMPIO:
     * Deposito 0.05 ETH → 0.05 / 0.001 = 50 messaggi disponibili
     *
     * @dev Il commitment NON rivela l'identità reale, è un hash crittografico
     *      L'identità completa rimane nel browser dell'utente
     */
    function joinGroupWithDeposit(uint256 identityCommitment) external payable {
        // Verifica deposito minimo (0.05 ETH)
        require(msg.value >= MIN_DEPOSIT, "Deposito insufficiente");  // Accetta la chiamata di questa funzione solo se l'utente ha inviato minimo 0.05 ETH

        // Aggiungi l'identityCommitment al gruppo Semaphore
        // Questo permette all'utente di generare proofs future
        // Solo questo contratto (admin) può chiamare addMember
        semaphore.addMember(groupId, identityCommitment);

        // Aggiorna il deposito dell'utente
        // Usiamo += perché l'utente potrebbe depositare più volte
        deposits[msg.sender] += msg.value;  // Tiene traccia dei depositi dell'utente utilizzando l'indirizzo dell'account con cui l'utente ha depositato
        // Messaggi disponibili = deposits / COST_PER_MESSAGE (es. 0.05 ETH / 0.001 = 50 messaggi)

        // Emetti eventi per tracking
        emit MemberJoined(identityCommitment);
        emit DepositMade(msg.sender, msg.value, deposits[msg.sender]);
    }

    /**
     * @notice Crea una richiesta di relay per postare un messaggio anonimo
     * @param merkleTreeRoot Root del Merkle tree al momento della proof generation
     * @param nullifierHash Hash univoco derivato dall'identità e dal messaggio
     * @param proof Array di 8 elementi che costituiscono la proof Groth16
     * @param message Testo del messaggio da postare
     * @param relayFee Fee che verrà pagata al relayer (deve essere <= deposito)
     * @param messageIndex Indice del messaggio usato come externalNullifier nella proof
     *
     * COME FUNZIONA:
     * 1. Utente legge messageCounter dalla blockchain
     * 2. Utente genera proof nel browser usando messageCounter come externalNullifier
     * 3. Chiama questa funzione per creare la request on-chain
     * 4. Gas cost basso (~50k gas) perché salviamo solo dati
     * 5. La proof NON viene verificata qui (viene verificata in executeRelay)
     * 6. Qualsiasi relayer può poi eseguire questa request
     *
     * PERCHÉ SEPARARE CREAZIONE ED ESECUZIONE?
     * - Privacy: Separa chi crea la request da chi la esegue
     * - Gas: L'utente paga poco gas, il relayer paga il gas della verifica
     * - Incentivi: Il relayer guadagna la fee, ha incentivo economico ad eseguire
     *
     * @dev La proof viene salvata ma verificata solo all'esecuzione
     *      Questo risparmia gas se la request non viene mai eseguita
     */
     
     /**
     * Questa funzione non posta il messaggio e non verifica la proof
     * Per prima cosa controlla che l'utente abbia i diritti economici per eseguirla
     * Avanza messageCounter e salva in storage una RelayRequest
     * Un relayer potrà eseguire la request dopo con executeRelay
     * é la fase di commit della richiesta
     */
     
    function createRelayRequest(
        uint256 merkleTreeRoot,  // root rispetto a cui l'utente ha costruito la Merkel Path dentro la proof
        uint256 nullifierHash,  // valore che sarà unico per identità+externaNullifier
        uint256[8] calldata proof,  // proof generata dal client
        string calldata message,  // testo in chiato del messaggio
        uint256 relayFee,  // fee da pagare al relayer
        uint256 messageIndex  // externalNullifier che deve essere uguale al contatore globale
    ) external {
        // Verifica che la relay fee sia almeno il costo minimo per messaggio (anti-spam)
        require(relayFee >= COST_PER_MESSAGE, "Relay fee deve essere >= COST_PER_MESSAGE");

        // Verifica che l'utente abbia abbastanza deposito per pagare la fee
        require(deposits[msg.sender] >= relayFee, "Deposito insufficiente per relay fee");

        // Verifica che messageIndex corrisponda al messageCounter corrente
        // Questo garantisce che la proof sia stata generata con l'externalNullifier corretto
        require(messageIndex == messageCounter, "Message index non valido");  // Si usa come externalNullifier messagerCounter che viene passato come msgIndex
	// Potrebbe creare race condition nel caso in cui più utenti cerchino di creare un messaggio allo stesso tempo. Molte transazioni potrebbero fallire.
	// Se usassi externalNullifier = groupID come nell'implementazione originale di semaphore, allora un'identità sarebbe limitata al post di 1 solo mex!
	// Usando messageCounter elimino questo vincolo e la proof è legata al contesto che il contratto considera valido adesso, ovvero messageCounter.
	
        // Verifica che questo nullifier non sia già stato usato
        // Previene il riuso della stessa proof (double-posting)
        require(!nullifierHashes[nullifierHash], "Nullifier gia usato");  // Evita il riuso di uno stesso nullifierHash

	// Qui passo alle modifiche allo stato del contratto
        // Nota: il deposito viene scalato in executeRelay() quando il relayer esegue la request
        // Questo evita di perdere ETH se la request non viene mai eseguita

        // Incrementa messageCounter per il prossimo messaggio
        messageCounter++;

        // Genera ID univoco per questa request
        uint256 requestId = nextRequestId++;

        // Salva la request in storage
        // Tutti questi dati saranno disponibili per il relayer
        relayRequests[requestId] = RelayRequest({
            merkleTreeRoot: merkleTreeRoot,       // Per verificare membership
            nullifierHash: nullifierHash,         // Per prevenire double-posting
            proof: proof,                         // La proof ZK (8 elementi)
            message: message,                     // Il messaggio da postare
            relayFee: relayFee,                   // Quanto pagare al relayer
            requester: msg.sender,                // Chi ha creato la request (per payment)
            executed: false,                      // Non ancora eseguita
            messageIndex: messageIndex            // ExternalNullifier usato per questa proof
        });

        // Emetti evento che i relayers ascolteranno
        emit RelayRequestCreated(requestId, msg.sender, relayFee);
    }

    /**
     * @notice Esegue una relay request (CHIUNQUE può chiamare questa funzione)
     * @param requestId ID della request da eseguire
     *
     * FLUSSO DI ESECUZIONE:
     * 1. Carica la request dallo storage
     * 2. Verifica che non sia già stata eseguita
     * 3. Calcola il signal hash dal messaggio
     * 4. Verifica la proof ZK tramite Semaphore
     * 5. Se valida: marca nullifier come usato, paga relayer, posta messaggio
     * 6. Se invalida: transaction reverted (nessun costo per chi chiama)
     *
     * INCENTIVI ECONOMICI:
     * - Relayer paga gas (~400k gas)
     * - Su Sepolia: gas praticamente gratis (testnet)
     * - Su Mainnet (30 gwei): ~0.012 ETH = ~$36 (ETH=$3000)
     * - Su L2 (Arbitrum/Optimism): ~$0.10-0.50
     * - Relayer riceve relayFee (minimo COST_PER_MESSAGE = 0.001 ETH)
     * - NOTA: Su Sepolia il sistema funziona perché ETH è gratis
     *
     * SICUREZZA:
     * - La proof garantisce che solo un membro del gruppo possa creare request valide
     * - Il nullifier garantisce che ogni identità possa postare ogni messaggio 1 sola volta
     * - Il relayer NON può modificare il messaggio (è parte della proof)
     *
     * @dev Questa funzione è "permissionless" - chiunque può chiamarla
     *      Questo rende il sistema decentralizzato: non serve un relayer specifico
     */
     
     /*
      * Questa funzione :
      *	- prende una relayRequest salvata in storage 
      * - verifica la ZK Proof (Semaphore)
      * - se valida marca il nullifier come usato, paga il relayer, emette l'evento del messaggio
      * - è permissionless, chiunque che sia nel gruppo può chiamarla.
     */
     
    function executeRelay(uint256 requestId) external {
        // Carica la request dallo storage (storage pointer per efficienza)
        RelayRequest storage request = relayRequests[requestId];
        /*
         * relayRequest è un mapping(uint256 => RelayRequest)
         * RelayRequest[requestId] recupera la struct RelayRequest salvata in storage a quella chiave 
         * Con RelayRequest storage request creo una variabile locale chiamata request che è un riferimento allo storage 
         * Perchè usare storage? 
         * - evitare di riscrivere relayRequests[requestId].campo ogni volta
         * - evitare copie in memoria (con memory avresti una copia e poi dovresti riscriverla nello storage a mano)
        */

        // Verifica che la request esista e non sia già stata eseguita
        require(!request.executed, "Richiesta gia eseguita");  // evita che la stessa richiesta venga eseguita 2 volte
        require(request.requester != address(0), "Richiesta non esistente");  // Controllo che la richiesta esista davvero
        // address(0) è il valore di default di un address non inizializzato
        // Se quella entry non è mai stata scritta, in Solidity viene assegnato un valore di default --> request.requester = 0x0

        // STEP 1: CALCOLO DEL SIGNAL
        // Il signal è l'hash del messaggio, troncato a 254 bit
        // >> 8 rimuove gli ultimi 8 bit per garantire che il valore
        // sia minore di SNARK_SCALAR_FIELD (~2^254)
        // Questo è necessario per la compatibilità con i circuiti ZK
        uint256 signal = uint256(keccak256(abi.encodePacked(request.message))) >> 8;
        // In semaphore il signal è "ciò che stai attestando" con la proof. In questo caso è l'hash del messaggio, quindi la proof sarà legata a quel mex

        // STEP 2: VERIFICA NULLIFIER NON USATO
        // Double-check anche se già verificato in createRelayRequest
        // Necessario per sicurezza in caso di race conditions
        require(!nullifierHashes[request.nullifierHash], "Nullifier gia usato");
        // Siccome tra la creazione della request e la sua esecuzione passa del tempo, qualcun altro avrebbe potuto eseguire un'altra request con lo stesso
        // nullifier. In questo modo evito replay attack.

        // STEP 3: VERIFICA PROOF ZK
        // Questa è la parte più importante: verifica che:
        // 1. L'identità che ha generato la proof è nel gruppo (merkleTreeRoot)
        // 2. Il signal (messaggio) è quello per cui la proof è stata generata
        // 3. Il nullifier è derivato correttamente dall'identità
        // 4. La proof è matematicamente valida (verifica crittografica)
        //
        // IMPORTANTE: Usiamo request.messageIndex come externalNullifier
        // Questo permette alla stessa identità di generare nullifier diversi
        // per ogni messaggio, abilitando messaggi multipli per identità
        //
        // SE LA PROOF NON È VALIDA: Semaphore fa REVERT, transaction fallisce
        // SE LA PROOF È VALIDA: Execution continua
        semaphore.verifyProof(
            groupId,                    // Gruppo di appartenenza
            request.merkleTreeRoot,     // Root del tree al momento della proof gen
            signal,                     // Hash del messaggio
            request.nullifierHash,      // Nullifier univoco
            request.messageIndex,       // External nullifier (messageIndex per multi-msg)
            request.proof               // La proof Groth16 (8 elementi)
        );
        /*
         * Questa chiamata fa si che semaphore verifichi che : 
         * 1. Esiste una foglia del Merkle tree (un membro del gruppo) coerente con request.merkleTreeRoot
         * 2. Il prover conosce i segreti dell'identità corrispondente (trapdoor + identity nullifier)
         * 3. Il signal è quello con cui è stata generata la prova
         * 4. Il nullifierHash è calcolato correttamente dall'identità e dall'externalNullifier
         * 5. La proof è matematicamente valida
         * externalNullifier = request.messageIndex (che in fase di creazione era messageCounter) permette messaggi multipli per identità perchè cambiando
         * l'externalNullifier cambia anche il nullifierHash
        */

        // STEP 4: AGGIORNA STATE
        // Se arriviamo qui, la proof è valida!

        // Marca il nullifier come usato per prevenire riutilizzo
        nullifierHashes[request.nullifierHash] = true;

        // Marca la request come eseguita
        request.executed = true;

        // STEP 5: PAGAMENTO RELAYER
        // Sottrai la fee dal deposito del requester
        deposits[request.requester] -= request.relayFee;

        // Trasferisci la fee al relayer (chi ha chiamato questa funzione)
        // msg.sender = indirizzo del relayer
        payable(msg.sender).transfer(request.relayFee);  // Sto pagando ETH al chiamante della funzione
        // msg.sender chi ha chiamato executeRelay
        // payable(msg.sender) converte quell'indirizzo in un payable address (address a cui può inviare ETH)
        // . transfer invia esattamente request.relayFee wei a quell'indirizzo

        // STEP 6: POST MESSAGGIO
        // Calcola hash del contenuto per il sistema di moderazione
        bytes32 contentHash = keccak256(abi.encodePacked(request.message));

        // Emetti evento che il frontend userà per mostrare il messaggio
        emit MessagePosted(contentHash, request.message, block.timestamp, messageCount);

        // Emetti evento di relay eseguito
        emit MessageRelayed(requestId, msg.sender, request.relayFee);

        // Incrementa contatore messaggi totali
        messageCount++;
    }

    // ═════════════════════════════════════════════════════════════════
    // DIRECT POSTING (NO RELAY)
    // ═════════════════════════════════════════════════════════════════

    /**
     * @notice Posta un messaggio DIRETTAMENTE senza usare il sistema di relay
     * @dev Questa funzione permette all'utente di postare il messaggio in una sola
     *      transazione, pagando direttamente il gas. A differenza del sistema relay:
     *      - NON richiede due transazioni (createRelayRequest + executeRelay)
     *      - NON richiede un relayer intermedio
     *      - NON richiede il pagamento di una relay fee
     *      - L'utente paga direttamente il gas della transazione
     *
     * @param merkleTreeRoot Root del Merkle tree al momento della generazione della proof
     * @param nullifierHash Hash del nullifier (previene double-posting)
     * @param proof Array di 8 elementi uint256 che costituiscono la proof Groth16
     * @param message Testo del messaggio da postare
     * @param messageIndex Indice usato come externalNullifier (deve essere == messageCounter)
     *
     * FLUSSO:
     * 1. Utente genera la ZK proof nel browser (come per relay)
     * 2. Utente chiama postMessageDirect() direttamente
     * 3. Contratto verifica la proof e posta il messaggio
     * 4. Messaggio pubblicato in UNA sola transazione
     *
     * CONFRONTO CON RELAY:
     * ┌─────────────────────────────────────────────────────────────────┐
     * │  DIRECT POST              │  RELAY POST                        │
     * ├─────────────────────────────────────────────────────────────────┤
     * │  1 transazione            │  2 transazioni                     │
     * │  Utente paga gas          │  Relayer paga gas (2a tx)          │
     * │  Nessuna fee extra        │  Relay fee richiesta               │
     * │  Più veloce               │  Dipende dal relayer               │
     * │  msg.sender visibile      │  msg.sender visibile in createReq  │
     * └─────────────────────────────────────────────────────────────────┘
     *
     * NOTA SULLA PRIVACY:
     * In entrambi i casi (direct e relay), l'indirizzo Ethereum che effettua
     * la transazione è visibile on-chain. La privacy garantita da Semaphore
     * riguarda l'IDENTITÀ SEMAPHORE (chi sei nel gruppo), non l'indirizzo
     * Ethereum usato per la transazione.
     *
     * SICUREZZA:
     * - La proof garantisce che solo un membro del gruppo possa postare
     * - Il nullifier previene che la stessa identità posti lo stesso messaggio due volte
     * - Il messageIndex garantisce che la proof sia stata generata per il contesto corrente
     */
    function postMessageDirect(
        uint256 merkleTreeRoot,
        uint256 nullifierHash,
        uint256[8] calldata proof,
        string calldata message,
        uint256 messageIndex
    ) external {
        // ─────────────────────────────────────────────────────────────────
        // STEP 1: VERIFICA DEPOSITO
        // ─────────────────────────────────────────────────────────────────
        // L'utente deve avere abbastanza deposito per pagare il costo del messaggio
        // Deposito ottenuto con joinGroupWithDeposit() o topUpDeposit()
        require(deposits[msg.sender] >= COST_PER_MESSAGE, "Deposito insufficiente");

        // ─────────────────────────────────────────────────────────────────
        // STEP 2: VERIFICA MESSAGE INDEX
        // ─────────────────────────────────────────────────────────────────
        // Il messageIndex deve corrispondere al messageCounter corrente
        // Questo garantisce che la proof sia stata generata con l'externalNullifier
        // corretto e previene race conditions
        require(messageIndex == messageCounter, "Message index non valido");

        // ─────────────────────────────────────────────────────────────────
        // STEP 3: CALCOLO SIGNAL
        // ─────────────────────────────────────────────────────────────────
        // Il signal è l'hash del messaggio, troncato a 254 bit
        // >> 8 rimuove gli ultimi 8 bit per garantire compatibilità con SNARK field
        // Questo è lo stesso calcolo fatto in executeRelay()
        uint256 signal = uint256(keccak256(abi.encodePacked(message))) >> 8;

        // ─────────────────────────────────────────────────────────────────
        // STEP 4: VERIFICA NULLIFIER NON USATO
        // ─────────────────────────────────────────────────────────────────
        // Controlla che questo nullifier non sia già stato usato
        // Previene replay attack e double-posting
        require(!nullifierHashes[nullifierHash], "Nullifier gia usato");

        // ─────────────────────────────────────────────────────────────────
        // STEP 5: VERIFICA PROOF ZK
        // ─────────────────────────────────────────────────────────────────
        // Chiama Semaphore per verificare che:
        // 1. L'identità che ha generato la proof è nel gruppo (merkleTreeRoot)
        // 2. Il signal (messaggio) è quello per cui la proof è stata generata
        // 3. Il nullifier è derivato correttamente dall'identità
        // 4. La proof è matematicamente valida
        //
        // SE LA PROOF NON È VALIDA: la funzione fa revert
        // SE LA PROOF È VALIDA: l'esecuzione continua
        semaphore.verifyProof(
            groupId,            // Gruppo Semaphore di questa board
            merkleTreeRoot,     // Root del Merkle tree usato per la proof
            signal,             // Hash del messaggio (>> 8)
            nullifierHash,      // Hash univoco per questa identità + externalNullifier
            messageIndex,       // externalNullifier (== messageCounter)
            proof               // La proof Groth16 (8 elementi uint256)
        );

        // ─────────────────────────────────────────────────────────────────
        // STEP 6: AGGIORNA STATE
        // ─────────────────────────────────────────────────────────────────
        // Se arriviamo qui, la proof è valida!

        // Marca il nullifier come usato per prevenire riutilizzo
        nullifierHashes[nullifierHash] = true;

        // Scala il costo del messaggio dal deposito ETH
        deposits[msg.sender] -= COST_PER_MESSAGE;

        // Incrementa il messageCounter per il prossimo messaggio
        // Questo cambia l'externalNullifier per le prossime proof
        messageCounter++;

        // ─────────────────────────────────────────────────────────────────
        // STEP 7: PUBBLICA MESSAGGIO
        // ─────────────────────────────────────────────────────────────────
        // Calcola hash del contenuto per il sistema di moderazione
        bytes32 contentHash = keccak256(abi.encodePacked(message));

        // Emetti evento MessagePosted - lo stesso evento usato da executeRelay
        // Il frontend ascolta questo evento per mostrare i messaggi
        emit MessagePosted(contentHash, message, block.timestamp, messageCount);

        // Incrementa contatore messaggi totali
        messageCount++;
    }

    // ═════════════════════════════════════════════════════════════════
    // DEPOSIT MANAGEMENT
    // ═════════════════════════════════════════════════════════════════

    /**
     * @notice Ricarica il deposito (top-up)
     * @dev Permette di aggiungere ETH al deposito esistente
     *      I messaggi disponibili aumentano automaticamente (deposits / COST_PER_MESSAGE)
     *
     * CASO D'USO:
     * Utente ha finito il deposito ma vuole continuare a postare
     * Deposita altro ETH per avere più messaggi disponibili
     */
    function topUpDeposit() external payable {
        // Verifica che sia stato inviato ETH
        require(msg.value > 0, "Deposito deve essere > 0");

        // Aggiungi al deposito esistente
        // Messaggi disponibili = deposits / COST_PER_MESSAGE (calcolato automaticamente)
        deposits[msg.sender] += msg.value;

        // Emetti evento per tracking
        emit DepositMade(msg.sender, msg.value, deposits[msg.sender]);
    }

    /**
     * @notice Ritira tutto il deposito rimanente
     * @dev Resetta deposito a zero e trasferisce ETH all'utente
     *
     * QUANDO USARE:
     * - Utente vuole uscire dalla piattaforma e recuperare i fondi
     * - Utente ha deposito inutilizzato e vuole il rimborso
     *
     * SICUREZZA:
     * - Solo l'owner del deposito può ritirarlo (msg.sender check implicito)
     * - Resetta PRIMA il balance (Checks-Effects-Interactions pattern)
     * - Previene re-entrancy attacks
     */
    function withdrawDeposit() external {
        // Leggi il deposito corrente
        uint256 amount = deposits[msg.sender];

        // Verifica che ci sia qualcosa da ritirare
        require(amount > 0, "Nessun deposito da ritirare");

        // CHECKS-EFFECTS-INTERACTIONS PATTERN
        // Prima modifichiamo lo state, poi trasferiamo
        // Questo previene re-entrancy attacks

        // Resetta deposito a zero
        deposits[msg.sender] = 0;

        // Trasferisci ETH all'utente
        payable(msg.sender).transfer(amount);

        // Emetti evento
        emit DepositWithdrawn(msg.sender, amount);
    }

}

/*
 * ═══════════════════════════════════════════════════════════════════════
 * RIASSUNTO CONTRATTO
 * ═══════════════════════════════════════════════════════════════════════
 *
 * COSA FA QUESTO CONTRATTO:
 * Implementa una bacheca messaggi dove gli utenti possono postare messaggi
 * senza rivelare la loro identity commitment Semaphore, utilizzando un sistema
 * di relay opzionale o posting diretto.
 *
 * COMPONENTI PRINCIPALI:
 * 1. Sistema di Identità (Semaphore): Gestisce identity commitments e proofs
 * 2. Sistema di Depositi: Gli utenti depositano ETH per poter postare
 * 3. Dual Mode: Posting diretto o tramite relay network
 *
 * FLUSSO TIPICO:
 * 1. User deposita 0.05 ETH → Può postare ~50 messaggi
 * 2. User genera proof ZK nel browser (offline, privato)
 * 3a. DIRECT: User posta direttamente (1 transazione)
 * 3b. RELAY: User crea request, relayer la esegue (2 transazioni)
 * 4. Il deposito viene scalato ad ogni messaggio
 * 5. Messaggio appare sulla board
 *
 * COSA È PROTETTO:
 * - L'identity commitment non è rivelata dalla proof
 * - Il commitment non è reversibile (hash crittografico)
 * - Il relayer non può modificare il messaggio
 * - La proof garantisce autenticità senza rivelare quale commitment
 * - Il nullifier previene double-posting
 *
 * COSA NON È PROTETTO:
 * - L'indirizzo Ethereum usato per le transazioni è VISIBILE on-chain
 * - Correlazione address → transazione → messaggio è possibile
 *
 * SICUREZZA:
 * - Proofs verificate crittograficamente (Groth16)
 * - Nullifier previene riutilizzo proofs
 * - Checks-Effects-Interactions pattern per evitare re-entrancy
 * - Admin isolato (solo questo contratto è admin del gruppo)
 *
 * GAS COSTS (stima):
 * - joinGroupWithDeposit: ~150k gas
 * - createRelayRequest: ~50k gas (basso!)
 * - executeRelay: ~400k gas (pagato dal relayer)
 * - postMessageDirect: ~400k gas
 *
 * ═══════════════════════════════════════════════════════════════════════
 */
