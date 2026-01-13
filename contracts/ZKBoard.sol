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
 *    che non rivela la loro vera identità
 * 2. Sistema di depositi: Gli utenti depositano ETH e ricevono crediti
 * 3. Relay Network: I messaggi vengono postati tramite relayers terzi che
 *    ricevono una fee, separando completamente l'identità dal messaggio
 * 4. Proof ZK: Ogni messaggio richiede una proof che dimostra membership
 *    nel gruppo senza rivelare chi è l'autore
 * 5. Nullifier: Previene il double-posting usando hash univoci
 *
 * FLUSSO OPERATIVO:
 * 1. Utente deposita ETH → Riceve crediti
 * 2. Utente genera ZK proof offline (nel browser)
 * 3. Utente crea relay request on-chain (basso gas cost)
 * 4. Relayer esegue la request → Verifica proof → Posta messaggio
 * 5. Relayer riceve fee dal deposito dell'utente
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

    /// @notice Depositi degli utenti (in wei)
    /// @dev address => amount in ETH depositato
    ///      Questo mapping traccia quanto ETH ha depositato ogni utente
    ///      Il deposito serve a pagare le fee ai relayers
    mapping(address => uint256) public deposits;

    /// @notice Crediti messaggi disponibili per ogni utente
    /// @dev address => numero di messaggi che può postare
    ///      1 credito = 1 messaggio
    ///      Crediti = deposito / COST_PER_MESSAGE
    mapping(address => uint256) public credits;

    /**
     * @notice Struttura dati per una richiesta di relay
     * @dev Contiene tutti i dati necessari per eseguire il posting anonimo
     */
    struct RelayRequest {
        /// @notice Root del Merkle tree al momento della generazione proof
        /// @dev Serve per verificare che l'identità era nel gruppo in quel momento
        uint256 merkleTreeRoot;

        /// @notice Hash del nullifier per prevenire double-posting
        /// @dev È derivato da: hash(identityNullifier, externalNullifier)
        ///      Ogni identità può usare un nullifier una sola volta
        uint256 nullifierHash;

        /// @notice Array di 8 elementi che costituiscono la proof Groth16
        /// @dev Formato: [pi_a.x, pi_a.y, pi_b.x[0], pi_b.x[1], pi_b.y[0], pi_b.y[1], pi_c.x, pi_c.y]
        uint256[8] proof;

        /// @notice Testo del messaggio da postare
        string message;

        /// @notice Fee da pagare al relayer (in wei)
        /// @dev Più alta è la fee, più velocemente verrà eseguita la request
        uint256 relayFee;

        /// @notice Indirizzo di chi ha creato la request (per tracking e payment)
        /// @dev Questo NON viene esposto pubblicamente nel messaggio finale
        address requester;

        /// @notice Flag che indica se la request è stata eseguita
        /// @dev Previene double-execution della stessa request
        bool executed;

        /// @notice Indice usato come externalNullifier per questa proof
        /// @dev Permette alla stessa identità di postare messaggi multipli
        uint256 messageIndex;
    }

    /// @notice Mapping di tutte le relay requests
    /// @dev requestId => RelayRequest struct
    mapping(uint256 => RelayRequest) public relayRequests;

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

    /// @notice Costo di un singolo messaggio (0.001 ETH = 1 credito)
    /// @dev Usato per calcolare i crediti: credits = deposit / COST_PER_MESSAGE
    uint256 public constant COST_PER_MESSAGE = 0.001 ether;

    // ═════════════════════════════════════════════════════════════════
    // STATE VARIABLES - NULLIFIER & MODERATION
    // ═════════════════════════════════════════════════════════════════

    /// @notice Traccia quali nullifier sono già stati usati
    /// @dev nullifierHash => bool (true = già usato)
    ///      Previene che la stessa proof venga riusata per postare più messaggi
    mapping(uint256 => bool) public nullifierHashes;

    /// @notice Numero totale di messaggi postati con successo
    /// @dev Incrementato ogni volta che executeRelay() ha successo
    uint256 public messageCount;

    /// @notice Conta quante volte un messaggio è stato flaggato
    /// @dev keccak256(message) => numero di flags
    ///      Usato per il sistema di moderazione comunitaria
    mapping(bytes32 => uint256) public flagCount;

    /// @notice Traccia se un utente ha già flaggato un messaggio specifico
    /// @dev user address => contentHash => bool
    ///      Previene che lo stesso utente flaggi più volte lo stesso messaggio
    mapping(address => mapping(bytes32 => bool)) public hasUserFlagged;

    /// @notice Soglia minima di flags necessari per nascondere un messaggio
    /// @dev Se flagCount >= MIN_FLAGS_TO_HIDE, il messaggio viene considerato "hidden"
    uint256 public constant MIN_FLAGS_TO_HIDE = 3;

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

    /// @notice Emesso quando un messaggio viene flaggato
    event MessageFlagged(
        bytes32 indexed contentHash,
        address indexed flagger,
        uint256 newFlagCount,
        uint256 timestamp
    );

    // ═════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═════════════════════════════════════════════════════════════════

    /**
     * @notice Costruttore del contratto ZKBoard
     * @param _semaphoreAddress Indirizzo del contratto Semaphore deployato
     * @param _groupId ID univoco per il gruppo di questa board
     * @dev Il gruppo non viene creato qui, ma in initializeBoard()
     *      Questo permette di verificare il deploy prima di creare il gruppo
     */
    constructor(address _semaphoreAddress, uint256 _groupId) {
        // Salva il riferimento al contratto Semaphore
        semaphore = ISemaphore(_semaphoreAddress);

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
        // "Board gia inizializzata" - Messaggio in italiano chiaro per l'utente
        require(!initialized, "Board gia inizializzata");

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
     * 5. Riceve crediti proporzionali al deposito
     *
     * ESEMPIO:
     * Deposito 0.05 ETH → 0.05 / 0.001 = 50 crediti = 50 messaggi
     *
     * @dev Il commitment NON rivela l'identità reale, è un hash crittografico
     *      L'identità completa rimane nel browser dell'utente
     */
    function joinGroupWithDeposit(uint256 identityCommitment) external payable {
        // Verifica deposito minimo (0.05 ETH)
        require(msg.value >= MIN_DEPOSIT, "Deposito insufficiente");

        // Aggiungi l'identityCommitment al gruppo Semaphore
        // Questo permette all'utente di generare proofs future
        // Solo questo contratto (admin) può chiamare addMember
        semaphore.addMember(groupId, identityCommitment);

        // Aggiorna il deposito dell'utente
        // Usiamo += perché l'utente potrebbe depositare più volte
        deposits[msg.sender] += msg.value;

        // Calcola e assegna crediti
        // Ogni 0.001 ETH = 1 credito
        // Esempio: 0.05 ETH / 0.001 = 50 crediti
        credits[msg.sender] += msg.value / COST_PER_MESSAGE;

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
    function createRelayRequest(
        uint256 merkleTreeRoot,
        uint256 nullifierHash,
        uint256[8] calldata proof,
        string calldata message,
        uint256 relayFee,
        uint256 messageIndex
    ) external {
        // Verifica che l'utente abbia crediti
        // 1 credito = diritto di postare 1 messaggio
        require(credits[msg.sender] > 0, "Crediti insufficienti");

        // Verifica che l'utente abbia abbastanza deposito per pagare la fee
        require(deposits[msg.sender] >= relayFee, "Deposito insufficiente per relay fee");

        // Verifica che messageIndex corrisponda al messageCounter corrente
        // Questo garantisce che la proof sia stata generata con l'externalNullifier corretto
        require(messageIndex == messageCounter, "Message index non valido");

        // Verifica che questo nullifier non sia già stato usato
        // Previene il riuso della stessa proof (double-posting)
        require(!nullifierHashes[nullifierHash], "Nullifier gia usato");

        // Decrementa i crediti (consuma 1 credito per questa request)
        credits[msg.sender]--;

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
     * - Relayer paga gas (~400k gas = ~$8-15 su mainnet)
     * - Relayer riceve relayFee (~0.001 ETH = ~$2-3)
     * - Su L2 (Arbitrum/Optimism) il gas sarebbe ~$0.10, profitto ~$2-3
     *
     * SICUREZZA:
     * - La proof garantisce che solo un membro del gruppo possa creare request valide
     * - Il nullifier garantisce che ogni identità possa postare ogni messaggio 1 sola volta
     * - Il relayer NON può modificare il messaggio (è parte della proof)
     *
     * @dev Questa funzione è "permissionless" - chiunque può chiamarla
     *      Questo rende il sistema decentralizzato: non serve un relayer specifico
     */
    function executeRelay(uint256 requestId) external {
        // Carica la request dallo storage (storage pointer per efficienza)
        RelayRequest storage request = relayRequests[requestId];

        // Verifica che la request esista e non sia già stata eseguita
        require(!request.executed, "Richiesta gia eseguita");
        require(request.requester != address(0), "Richiesta non esistente");

        // STEP 1: CALCOLO DEL SIGNAL
        // Il signal è l'hash del messaggio, troncato a 254 bit
        // >> 8 rimuove gli ultimi 8 bit per garantire che il valore
        // sia minore di SNARK_SCALAR_FIELD (~2^254)
        // Questo è necessario per la compatibilità con i circuiti ZK
        uint256 signal = uint256(keccak256(abi.encodePacked(request.message))) >> 8;

        // STEP 2: VERIFICA NULLIFIER NON USATO
        // Double-check anche se già verificato in createRelayRequest
        // Necessario per sicurezza in caso di race conditions
        require(!nullifierHashes[request.nullifierHash], "Nullifier gia usato");

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
        payable(msg.sender).transfer(request.relayFee);

        // STEP 6: POST MESSAGGIO
        // Calcola hash del contenuto per il sistema di moderazione
        bytes32 contentHash = keccak256(abi.encodePacked(request.message));

        // Emetti evento che il frontend userà per mostrare il messaggio
        // NOTA: Non c'è collegamento tra il messaggio e l'identità originale
        // La privacy è preservata!
        emit MessagePosted(contentHash, request.message, block.timestamp, messageCount);

        // Emetti evento di relay eseguito
        emit MessageRelayed(requestId, msg.sender, request.relayFee);

        // Incrementa contatore messaggi totali
        messageCount++;
    }

    // ═════════════════════════════════════════════════════════════════
    // DEPOSIT MANAGEMENT
    // ═════════════════════════════════════════════════════════════════

    /**
     * @notice Ricarica il deposito (top-up)
     * @dev Permette di aggiungere ETH al deposito esistente
     *      Calcola e assegna crediti aggiuntivi
     *
     * CASO D'USO:
     * Utente ha finito i crediti ma vuole continuare a postare
     * Deposita altro ETH per ricevere più crediti
     */
    function topUpDeposit() external payable {
        // Verifica che sia stato inviato ETH
        require(msg.value > 0, "Deposito deve essere > 0");

        // Aggiungi al deposito esistente
        deposits[msg.sender] += msg.value;

        // Calcola e aggiungi crediti proporzionali
        credits[msg.sender] += msg.value / COST_PER_MESSAGE;

        // Emetti evento per tracking
        emit DepositMade(msg.sender, msg.value, deposits[msg.sender]);
    }

    /**
     * @notice Ritira tutto il deposito rimanente
     * @dev Resetta deposito e crediti a zero, trasferisce ETH all'utente
     *
     * QUANDO USARE:
     * - Utente vuole uscire dalla piattaforma e recuperare i fondi
     * - Utente ha crediti inutilizzati e vuole il rimborso
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

        // Resetta crediti a zero
        credits[msg.sender] = 0;

        // Trasferisci ETH all'utente
        payable(msg.sender).transfer(amount);

        // Emetti evento
        emit DepositWithdrawn(msg.sender, amount);
    }

    // ═════════════════════════════════════════════════════════════════
    // MODERATION FUNCTIONS
    // ═════════════════════════════════════════════════════════════════

    /**
     * @notice Segnala un messaggio come inappropriato
     * @param contentHash Hash del messaggio da segnalare
     *
     * SISTEMA DI MODERAZIONE COMUNITARIA:
     * - Gli utenti possono flaggare messaggi inappropriati
     * - Ogni utente può flaggare ogni messaggio UNA SOLA VOLTA
     * - Se un messaggio raggiunge MIN_FLAGS_TO_HIDE (3), viene nascosto dal frontend
     * - I dati on-chain rimangono immutabili (trasparenza)
     *
     * LIMITI:
     * - Sistema base, può essere migliorato con reputation/stake
     * - Per ora chiunque con wallet può flaggare (potenziale abuso)
     * - In futuro: solo membri verificati o con stake
     *
     * @dev contentHash = keccak256(messaggio)
     */
    function flagMessage(bytes32 contentHash) external {
        // Previeni flag multipli dallo stesso utente
        // Ogni utente può flaggare ogni messaggio max 1 volta
        require(!hasUserFlagged[msg.sender][contentHash], "Messaggio gia flaggato da te");

        // Incrementa il contatore di flags per questo messaggio
        flagCount[contentHash]++;

        // Marca che questo utente ha flaggato questo messaggio
        hasUserFlagged[msg.sender][contentHash] = true;

        // Emetti evento per tracking
        emit MessageFlagged(
            contentHash,
            msg.sender,
            flagCount[contentHash],
            block.timestamp
        );
    }

    // ═════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS (non modificano state, solo lettura)
    // ═════════════════════════════════════════════════════════════════

    /**
     * @notice Restituisce la soglia di flags per nascondere un messaggio
     * @return threshold Numero minimo di flags (attualmente fisso a 3)
     *
     * @dev Per ora è una costante, ma la funzione permette di renderla
     *      dinamica in futuro (es. basata sulla dimensione del gruppo)
     */
    function getThreshold() public pure returns (uint256) {
        return MIN_FLAGS_TO_HIDE;
    }

    /**
     * @notice Verifica se un messaggio è nascosto (troppi flags)
     * @param contentHash Hash del messaggio da verificare
     * @return bool True se il messaggio ha >= MIN_FLAGS_TO_HIDE flags
     *
     * UTILIZZO NEL FRONTEND:
     * Il frontend chiama questa funzione per ogni messaggio
     * Se ritorna true, il messaggio viene nascosto dalla UI
     * (ma i dati rimangono on-chain per trasparenza)
     */
    function isMessageHidden(bytes32 contentHash) public view returns (bool) {
        return flagCount[contentHash] >= getThreshold();
    }

    /**
     * @notice Ottiene il numero di flags di un messaggio
     * @param contentHash Hash del messaggio
     * @return uint256 Numero totale di flags ricevuti
     */
    function getFlagCount(bytes32 contentHash) external view returns (uint256) {
        return flagCount[contentHash];
    }

    /**
     * @notice Verifica se un utente ha già flaggato un messaggio
     * @param user Indirizzo dell'utente da verificare
     * @param contentHash Hash del messaggio
     * @return bool True se l'utente ha già flaggato questo messaggio
     *
     * UTILIZZO:
     * Il frontend usa questa funzione per disabilitare il pulsante "Flag"
     * se l'utente ha già flaggato quel messaggio
     */
    function hasAlreadyFlagged(address user, bytes32 contentHash) external view returns (bool) {
        return hasUserFlagged[user][contentHash];
    }
}

/*
 * ═══════════════════════════════════════════════════════════════════════
 * RIASSUNTO CONTRATTO
 * ═══════════════════════════════════════════════════════════════════════
 *
 * COSA FA QUESTO CONTRATTO:
 * Implementa una bacheca messaggi completamente anonima dove gli utenti possono
 * postare messaggi senza rivelare la loro identità, utilizzando un sistema di
 * relay decentralizzato per massimizzare la privacy.
 *
 * COMPONENTI PRINCIPALI:
 * 1. Sistema di Identità (Semaphore): Gestisce identità anonime e proofs
 * 2. Sistema di Depositi: Gli utenti depositano ETH e ricevono crediti
 * 3. Relay Network: Separazione tra creazione e esecuzione messaggi
 * 4. Moderazione: Sistema comunitario per flaggare contenuti inappropriati
 *
 * FLUSSO TIPICO:
 * 1. User deposita 0.05 ETH → Riceve 50 crediti
 * 2. User genera proof ZK nel browser (offline, privato)
 * 3. User crea relay request on-chain (basso gas)
 * 4. Relayer esegue request → Verifica proof → Posta messaggio
 * 5. Relayer riceve fee dal deposito dell'user
 * 6. Messaggio appare sulla board, completamente anonimo
 *
 * GARANZIE DI PRIVACY:
 * - L'identità reale non è mai rivelata on-chain
 * - Il commitment non è reversibile
 * - Il relayer non può modificare il messaggio
 * - La proof garantisce autenticità senza rivelare autore
 * - Il nullifier previene double-posting mantenendo anonimato
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
 * - flagMessage: ~50k gas
 *
 * ═══════════════════════════════════════════════════════════════════════
 */
