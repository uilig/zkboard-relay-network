/*
╔═══════════════════════════════════════════════════════════════════════════════╗
║                      ⚙️ COSTANTI E CONFIGURAZIONI                              ║
║                                                                                ║
║  File centrale che contiene tutte le costanti, indirizzi dei contratti e ABI  ║
║  utilizzate dall'applicazione frontend.                                       ║
║                                                                                ║
║  SCOPO:                                                                        ║
║  - Centralizzare le configurazioni in un unico posto (DRY principle)          ║
║  - Definire gli ABI dei contratti per interagire con la blockchain            ║
║  - Impostare i parametri economici (fee, depositi, costi)                     ║
║                                                                                ║
║  COSA CONTIENE:                                                               ║
║  1. ZKBOARD_ADDRESS: indirizzo del contratto ZKBoard deployato su Sepolia     ║
║  2. FALLBACK_GROUP_ID: ID del gruppo Semaphore usato dall'app                 ║
║  3. SEMAPHORE_ABI: ABI minimale per leggere dal contratto Semaphore           ║
║  4. ZKBOARD_ABI: ABI completa del contratto ZKBoard                           ║
║  5. Costanti economiche: MIN_DEPOSIT, COST_PER_MESSAGE, DEFAULT_RELAY_FEE     ║
║                                                                                ║
║  NOTA IMPORTANTE:                                                             ║
║  Questo file viene importato da TUTTE le pagine che interagiscono con i       ║
║  contratti. Modifiche qui si propagano automaticamente a tutto il frontend.   ║
║                                                                                ║
║  FILE: frontend/app/utils/constants.ts                                        ║
║  USATO DA: page.tsx, board/page.tsx, relay/page.tsx, api/logs/route.ts        ║
╚═══════════════════════════════════════════════════════════════════════════════╝
*/

// ============================================================================
// INDIRIZZI CONTRATTI
// ============================================================================

// Indirizzo del contratto ZKBoard deployato su Sepolia testnet
export const ZKBOARD_ADDRESS = "0x2dB01A5BB26d8BBc0795522e784D2f796aAFa963";
// IMPORTANTE: Questo indirizzo è specifico per il deployment su Sepolia
// Se rideploy il contratto, devi aggiornare questo valore!
// Per ottenere l'indirizzo dopo il deploy: npx hardhat run scripts/deploy.ts --network sepolia

// ============================================================================
// GRUPPO SEMAPHORE
// ============================================================================

// ID del gruppo Semaphore usato dall'applicazione
export const FALLBACK_GROUP_ID = 1768337653;
// COSA È: Ogni applicazione Semaphore crea un gruppo con un ID univoco
// COME È GENERATO: Il contratto ZKBoard crea automaticamente un gruppo durante il deploy
// PERCHÉ SI CHIAMA FALLBACK: In alcune versioni precedenti c'era la possibilità di
//                             passare un groupId custom. Ora usiamo sempre quello del contratto.
// NOTA: Tutti i membri dell'applicazione fanno parte di questo gruppo condiviso

// ============================================================================
// ABI CONTRATTO SEMAPHORE
// ============================================================================

// ABI minimale per interagire con il contratto Semaphore v3
// Contiene SOLO le funzioni che ci servono (non l'ABI completa)
export const SEMAPHORE_ABI = [
  {
    // Funzione groups(uint256 groupId) → (admin, depth, size, root)
    // Restituisce le informazioni di un gruppo Semaphore
    "inputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "name": "groups",
    "outputs": [
      { "internalType": "address", "name": "admin", "type": "address" },
      // admin: indirizzo dell'amministratore del gruppo (può aggiungere/rimuovere membri)
      { "internalType": "uint256", "name": "depth", "type": "uint256" },
      // depth: profondità del Merkle tree (20 = max 1,048,576 membri)
      { "internalType": "uint256", "name": "size", "type": "uint256" },
      // size: numero di membri attualmente nel gruppo
      { "internalType": "uint256", "name": "root", "type": "uint256" },
      // root: radice del Merkle tree (cambia ogni volta che un membro viene aggiunto)
    ],
    "stateMutability": "view",  // view = non modifica lo stato, non costa gas
    "type": "function"
  }
] as const;
// `as const` dice a TypeScript di trattare questo come readonly e inferire i tipi letterali
// Questo è necessario per la type-safety di Wagmi v2

// ============================================================================
// ABI CONTRATTO ZKBOARD
// ============================================================================

// ABI completa del contratto ZKBoard
// Contiene TUTTE le funzioni ed eventi che usiamo
export const ZKBOARD_ABI = [

  // -------------------------------------------------------------------------
  // FUNZIONI VIEW (lettura, non costano gas)
  // -------------------------------------------------------------------------

  {
    // Funzione groupId() → uint256
    // Restituisce l'ID del gruppo Semaphore usato da questo contratto
    "inputs": [],
    "name": "groupId",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },

  {
    // Funzione deposits(address user) → uint256
    // Restituisce il deposito ETH di un utente
    "inputs": [{ "internalType": "address", "name": "user", "type": "address" }],
    "name": "deposits",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
    // ESEMPIO: deposits(0x1234...) → 10000000000000000 (0.01 ETH)
  },

  {
    // Funzione credits(address user) → uint256
    // Restituisce i crediti di un utente (quanti messaggi può postare via relay)
    "inputs": [{ "internalType": "address", "name": "user", "type": "address" }],
    "name": "credits",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
    // CALCOLO: credits = deposits / COST_PER_MESSAGE
    // ESEMPIO: deposito 0.01 ETH → credits = 10 (0.01 / 0.001)
  },

  {
    // Funzione nextRequestId() → uint256
    // Restituisce l'ID della prossima richiesta di relay
    "inputs": [],
    "name": "nextRequestId",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
    // ESEMPIO: se nextRequestId=10, esistono le richieste con ID da 0 a 9
  },

  {
    // Funzione messageCounter() → uint256
    // Restituisce il contatore globale usato come externalNullifier
    // Permette alla stessa identità di postare messaggi multipli
    "inputs": [],
    "name": "messageCounter",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },

  {
    // Funzione relayRequests(uint256 requestId) → (merkleTreeRoot, nullifierHash, message, relayFee, requester, executed, messageIndex)
    // Restituisce i dati di una richiesta di relay
    "inputs": [{ "internalType": "uint256", "name": "requestId", "type": "uint256" }],
    "name": "relayRequests",
    "outputs": [
      { "internalType": "uint256", "name": "merkleTreeRoot", "type": "uint256" },
      // merkleTreeRoot: radice del Merkle tree al momento della creazione richiesta
      { "internalType": "uint256", "name": "nullifierHash", "type": "uint256" },
      // nullifierHash: hash del nullifier (previene double-posting)
      // NOTA: La proof (uint256[8]) NON è inclusa nell'output!
      //       Solidity omette automaticamente gli array dai getter pubblici.
      //       La proof è salvata nello storage ma non accessibile via questo getter.
      { "internalType": "string", "name": "message", "type": "string" },
      // message: il testo del messaggio da postare
      { "internalType": "uint256", "name": "relayFee", "type": "uint256" },
      // relayFee: la fee offerta al relayer (in wei)
      { "internalType": "address", "name": "requester", "type": "address" },
      // requester: indirizzo di chi ha creato la richiesta
      { "internalType": "bool", "name": "executed", "type": "bool" },
      // executed: true se già eseguita, false se ancora pending
      { "internalType": "uint256", "name": "messageIndex", "type": "uint256" },
      // messageIndex: indice usato come externalNullifier per questa proof
    ],
    "stateMutability": "view",
    "type": "function"
  },

  // -------------------------------------------------------------------------
  // FUNZIONI WRITE (modificano stato, costano gas)
  // -------------------------------------------------------------------------

  {
    // Funzione joinGroup(uint256 identityCommitment)
    // Unisce un'identità Semaphore al gruppo (SENZA depositare ETH)
    "inputs": [{ "internalType": "uint256", "name": "identityCommitment", "type": "uint256" }],
    "name": "joinGroup",
    "outputs": [],
    "stateMutability": "nonpayable",  // nonpayable = non accetta ETH
    "type": "function"
    // USO: Per utenti che vogliono solo leggere, senza postare
    // GAS: ~50k gas
  },

  {
    // Funzione joinGroupWithDeposit(uint256 identityCommitment)
    // Unisce un'identità al gruppo E deposita ETH per messaggi via relay
    "inputs": [{ "internalType": "uint256", "name": "identityCommitment", "type": "uint256" }],
    "name": "joinGroupWithDeposit",
    "outputs": [],
    "stateMutability": "payable",  // payable = può ricevere ETH
    "type": "function"
    // USO: Per utenti che vogliono postare messaggi via relay
    // RICHIEDE: msg.value >= MIN_DEPOSIT (0.05 ETH)
    // GAS: ~70k gas
    // ESEMPIO: joinGroupWithDeposit(123...456, { value: parseEther("0.05") })
  },

  {
    // Funzione postMessage(merkleTreeRoot, nullifierHash, proof, message)
    // Posta un messaggio direttamente (l'utente paga il gas)
    "inputs": [
      { "internalType": "uint256", "name": "merkleTreeRoot", "type": "uint256" },
      { "internalType": "uint256", "name": "nullifierHash", "type": "uint256" },
      { "internalType": "uint256[8]", "name": "proof", "type": "uint256[8]" },
      { "internalType": "string", "name": "message", "type": "string" }
    ],
    "name": "postMessage",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
    // USO: Per utenti che hanno ETH per pagare il gas (~400k gas)
    // PROCESSO:
    // 1. Genera proof ZK client-side
    // 2. Chiama postMessage con proof + messaggio
    // 3. Contratto verifica proof
    // 4. Se valida → emette MessagePosted
  },

  {
    // Funzione createRelayRequest(merkleTreeRoot, nullifierHash, proof, message, relayFee, messageIndex)
    // Crea una richiesta di relay (l'utente NON paga il gas di verifica proof)
    "inputs": [
      { "internalType": "uint256", "name": "merkleTreeRoot", "type": "uint256" },
      { "internalType": "uint256", "name": "nullifierHash", "type": "uint256" },
      { "internalType": "uint256[8]", "name": "proof", "type": "uint256[8]" },
      { "internalType": "string", "name": "message", "type": "string" },
      { "internalType": "uint256", "name": "relayFee", "type": "uint256" },
      { "internalType": "uint256", "name": "messageIndex", "type": "uint256" }
    ],
    "name": "createRelayRequest",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
    // USO: Per utenti senza ETH (o che vogliono rimanere anonimi)
    // PROCESSO:
    // 1. Legge messageCounter dalla blockchain
    // 2. Genera proof ZK client-side con messageCounter come externalNullifier
    // 3. Chiama createRelayRequest con proof + messaggio + fee + messageIndex
    // 4. Contratto salva la richiesta (NON verifica ancora la proof!)
    // 5. Un relayer chiamerà executeRelay(requestId) più tardi
    // GAS: ~50k gas (molto meno di postMessage!)
    // RICHIEDE: credits >= 1 (l'utente deve avere depositato ETH)
  },

  {
    // Funzione executeRelay(uint256 requestId)
    // Esegue una richiesta di relay (chiamata da un relayer)
    "inputs": [{ "internalType": "uint256", "name": "requestId", "type": "uint256" }],
    "name": "executeRelay",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
    // USO: Per relayer che vogliono guadagnare fee
    // PROCESSO:
    // 1. Legge relayRequests[requestId]
    // 2. Verifica la proof ZK (COSTOSO: ~350k gas!)
    // 3. Se valida → emette MessagePosted
    // 4. Trasferisce relayFee al relayer (msg.sender)
    // 5. Marca executed = true
    // GAS: ~400k gas
    // GUADAGNO: relayFee - (gas_cost * gas_price)
  },

  {
    // Funzione topUpDeposit()
    // Aggiunge ETH al deposito dell'utente (aumenta i crediti)
    "inputs": [],
    "name": "topUpDeposit",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
    // USO: Per aggiungere crediti dopo la registrazione iniziale
    // CALCOLO: credits += msg.value / COST_PER_MESSAGE
    // ESEMPIO: topUpDeposit({ value: parseEther("0.01") }) → +10 credits
  },

  {
    // Funzione withdrawDeposit()
    // Preleva tutto il deposito dell'utente (azzera i crediti)
    "inputs": [],
    "name": "withdrawDeposit",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
    // USO: Per recuperare i fondi non utilizzati
    // EFFETTO: deposits[msg.sender] = 0, credits[msg.sender] = 0
    // TRASFERISCE: tutto il deposito a msg.sender
    // NOTA: Non si può prelevare parzialmente, solo tutto o niente
  },

  // -------------------------------------------------------------------------
  // EVENTI (emessi dal contratto, ascoltati dal frontend)
  // -------------------------------------------------------------------------

  {
    // Evento MemberJoined(uint256 identityCommitment)
    // Emesso quando un nuovo membro unisce il gruppo
    "anonymous": false,
    "inputs": [{ "indexed": false, "internalType": "uint256", "name": "identityCommitment", "type": "uint256" }],
    "name": "MemberJoined",
    "type": "event"
    // QUANDO: joinGroup() o joinGroupWithDeposit() chiamate
    // USO: Per aggiornare la lista membri nella UI
    // indexed=false: il valore è nei dati dell'evento, non nei topics (non filtrabile)
  },

  {
    // Evento MessagePosted(string message, uint256 timestamp)
    // Emesso quando un messaggio viene postato con successo
    "anonymous": false,
    "inputs": [
      { "indexed": false, "internalType": "string", "name": "message", "type": "string" },
      { "indexed": false, "internalType": "uint256", "name": "timestamp", "type": "uint256" }
    ],
    "name": "MessagePosted",
    "type": "event"
    // QUANDO: postMessage() o executeRelay() completati con successo
    // USO: Per mostrare nuovi messaggi nella board in tempo reale
    // NOTA: Questa è la VECCHIA firma (2 parametri)
    //       Il contratto reale emette 4 parametri (contentHash, message, timestamp, messageId)
    //       Ma questa ABI minimale funziona comunque per la lettura base
  },

  {
    // Evento RelayRequestCreated(uint256 requestId, uint256 relayFee, uint256 timestamp)
    // Emesso quando viene creata una nuova richiesta di relay
    "anonymous": false,
    "inputs": [
      { "indexed": false, "internalType": "uint256", "name": "requestId", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "relayFee", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "timestamp", "type": "uint256" }
    ],
    "name": "RelayRequestCreated",
    "type": "event"
    // QUANDO: createRelayRequest() chiamata
    // USO: Per aggiornare la dashboard relay in tempo reale
    // requestId: ID della richiesta creata (0, 1, 2, ...)
    // relayFee: fee offerta (in wei)
    // timestamp: quando è stata creata
  },

  {
    // Evento MessageRelayed(uint256 requestId, address indexed relayer, uint256 fee)
    // Emesso quando un relayer esegue con successo una richiesta
    "anonymous": false,
    "inputs": [
      { "indexed": false, "internalType": "uint256", "name": "requestId", "type": "uint256" },
      { "indexed": true, "internalType": "address", "name": "relayer", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "fee", "type": "uint256" }
    ],
    "name": "MessageRelayed",
    "type": "event"
    // QUANDO: executeRelay() completato con successo
    // USO: Per tracciare quali relayer hanno eseguito richieste
    // indexed=true su relayer: permette di filtrare eventi per relayer specifico
    // ESEMPIO: events.filter(e => e.relayer === myAddress) → solo i miei relay
  },

  {
    // Evento DepositToppedUp(address indexed user, uint256 amount, uint256 credits)
    // Emesso quando un utente aggiunge ETH al suo deposito
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "user", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "credits", "type": "uint256" }
    ],
    "name": "DepositToppedUp",
    "type": "event"
    // QUANDO: joinGroupWithDeposit() o topUpDeposit() chiamate
    // USO: Per mostrare notifica all'utente "Deposito aggiunto!"
    // indexed=true su user: permette di filtrare per utente specifico
    // amount: ETH depositati (in wei)
    // credits: crediti totali dopo il deposito
  }
] as const;

// ============================================================================
// COSTANTI ECONOMICHE
// ============================================================================

// Deposito minimo richiesto per unirsi con deposito
export const MIN_DEPOSIT = '0.05';  // 0.05 ETH
// PERCHÉ: Garantisce che l'utente possa postare almeno 50 messaggi (0.05 / 0.001 = 50)
// NOTA: Valore alto per evitare spam. In produzione potrebbe essere ridotto.

// Costo per messaggio (detratto dai crediti)
export const COST_PER_MESSAGE = '0.001';  // 0.001 ETH = 1 finney = 1,000,000 gwei
// CALCOLO: Ogni messaggio via relay costa 0.001 ETH
// CREDITI: credits = deposits / COST_PER_MESSAGE
// ESEMPIO: deposito 0.01 ETH → credits = 10 messaggi

// Fee di default per le richieste di relay
export const DEFAULT_RELAY_FEE = '0.001';  // 0.001 ETH
// NOTA IMPORTANTE: Questa fee è SOTTOCOSTO!
// Gas per executeRelay: ~400k gas = ~0.0015 ETH (a 15 gwei)
// Fee guadagnata: 0.001 ETH
// PROFITTO: -0.0005 ETH (PERDITA!)
//
// IN PRODUZIONE DOVREBBE ESSERE:
// - Sepolia: 0.007 ETH (per coprire gas + margine)
// - Mainnet: 0.015 ETH (per coprire gas + margine)
//
// PERCHÉ È COSÌ BASSA QUI:
// - Progetto educativo, non pensato per uso reale
// - Facilita i test senza spendere troppo ETH
// - Dimostra il concetto del relay system

/*
╔═══════════════════════════════════════════════════════════════════════════════╗
║                          📚 SUMMARY EDUCATIVO                                  ║
╚═══════════════════════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. SCOPO DEL FILE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Questo file implementa il pattern "Single Source of Truth" per le configurazioni:

PRINCIPIO DRY (Don't Repeat Yourself):
  → Invece di hardcodare indirizzi/ABI in ogni file
  → Li definiamo UNA SOLA VOLTA qui
  → Tutti gli altri file importano da qui
  → Se cambia qualcosa (es: nuovo deploy) → modifichiamo solo questo file

ESEMPIO SENZA constants.ts (BAD):
  page.tsx:         const address = "0xbB0d..."
  board/page.tsx:   const address = "0xbB0d..."
  relay/page.tsx:   const address = "0xbB0d..."
  api/logs/route.ts: const address = "0xbB0d..."
  → Se rideploy il contratto → devo modificare 4 file! 😱

ESEMPIO CON constants.ts (GOOD):
  constants.ts:     export const ZKBOARD_ADDRESS = "0xbB0d..."
  page.tsx:         import { ZKBOARD_ADDRESS } from './utils/constants'
  board/page.tsx:   import { ZKBOARD_ADDRESS } from '../utils/constants'
  relay/page.tsx:   import { ZKBOARD_ADDRESS } from '../utils/constants'
  api/logs/route.ts: import { ZKBOARD_ADDRESS } from '../../utils/constants'
  → Se rideploy il contratto → modifico SOLO constants.ts! ✅

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. ABI: Cos'è e come funziona
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ABI = Application Binary Interface

ANALOGIA:
  - Contratto Solidity = Libro in lingua straniera
  - ABI = Dizionario per tradurre
  - JavaScript non può leggere Solidity direttamente
  - ABI dice: "questa funzione si chiama 'postMessage', prende 4 parametri, etc."

STRUTTURA DI UNA FUNZIONE NELL'ABI:

{
  "name": "postMessage",              // Nome della funzione
  "inputs": [                          // Parametri richiesti
    { "name": "merkleTreeRoot", "type": "uint256" },
    { "name": "nullifierHash", "type": "uint256" },
    { "name": "proof", "type": "uint256[8]" },
    { "name": "message", "type": "string" }
  ],
  "outputs": [],                       // Cosa restituisce (niente in questo caso)
  "stateMutability": "nonpayable",     // Può ricevere ETH? No
  "type": "function"                   // È una funzione (non evento/costruttore)
}

COME WAGMI USA L'ABI:

1. Tu scrivi:
   writeContract({
     address: ZKBOARD_ADDRESS,
     abi: ZKBOARD_ABI,
     functionName: 'postMessage',
     args: [root, nullifier, proof, message]
   })

2. Wagmi cerca in ZKBOARD_ABI la funzione "postMessage"
3. Legge i tipi degli input: [uint256, uint256, uint256[8], string]
4. Codifica i tuoi args in formato binario (ABI encoding)
5. Crea la transazione con i dati codificati
6. La invia alla blockchain

SENZA ABI:
  → Dovresti codificare manualmente i dati (nightmare!)
  → Esempio: keccak256("postMessage(uint256,uint256,uint256[8],string)").slice(0,8) + encode(args)

CON ABI:
  → Wagmi fa tutto automaticamente ✅

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. DIFFERENZA TRA FUNZIONI VIEW E WRITE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FUNZIONI VIEW (stateMutability: "view" o "pure"):
  - Leggono lo stato ma NON lo modificano
  - NON costano gas (gratis!)
  - NON richiedono firma con wallet
  - Risultato disponibile immediatamente
  - ESEMPI: groupId(), deposits(address), credits(address), relayRequests(id)

FUNZIONI WRITE (stateMutability: "nonpayable" o "payable"):
  - Modificano lo stato della blockchain
  - COSTANO gas (devi pagare!)
  - Richiedono firma con MetaMask/wallet
  - Risultato disponibile dopo 12-15 secondi (mining)
  - ESEMPI: joinGroup(), postMessage(), createRelayRequest(), executeRelay()

COME USARLE IN WAGMI:

VIEW:
  const { data } = useReadContract({
    address: ZKBOARD_ADDRESS,
    abi: ZKBOARD_ABI,
    functionName: 'deposits',
    args: [myAddress]
  })
  // data contiene il risultato immediatamente
  // Nessuna transazione, nessun gas, nessuna firma

WRITE:
  const { writeContract } = useWriteContract()
  writeContract({
    address: ZKBOARD_ADDRESS,
    abi: ZKBOARD_ABI,
    functionName: 'topUpDeposit',
    value: parseEther('0.01')
  })
  // Si apre MetaMask → user firma → transazione inviata
  // Gas stimato mostrato in MetaMask
  // Attesa 12-15 secondi per conferma

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. EVENTI: Come funzionano
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Gli EVENTI sono il modo con cui i contratti "comunicano" con il mondo esterno.

PROBLEMA: Come fa il frontend a sapere quando un nuovo messaggio viene postato?

SOLUZIONE NAIVE (BAD):
  → Ogni secondo, chiama readContract per vedere se ci sono nuovi messaggi
  → PROBLEMI:
    * Spreco di risorse (migliaia di chiamate inutili)
    * Ritardo (fino a 1 secondo)
    * Rate limiting dai provider RPC

SOLUZIONE CON EVENTI (GOOD):
  → Il contratto EMETTE un evento quando succede qualcosa
  → Il frontend ASCOLTA quell'evento
  → Quando l'evento viene emesso → callback eseguita

ESEMPIO:

CONTRATTO (Solidity):
  function postMessage(...) external {
    // ... verifica proof ...
    emit MessagePosted(message, block.timestamp);
  }

FRONTEND (TypeScript):
  useWatchContractEvent({
    address: ZKBOARD_ADDRESS,
    abi: ZKBOARD_ABI,
    eventName: 'MessagePosted',
    onLogs(logs) {
      console.log("Nuovo messaggio!", logs[0].args.message)
      // Aggiorna la UI
    }
  })

FLOW COMPLETO:
  1. User chiama postMessage()
  2. Contratto verifica proof
  3. Contratto emette MessagePosted(message, timestamp)
  4. Evento salvato nei log del blocco
  5. Wagmi riceve l'evento via WebSocket
  6. onLogs() callback eseguita
  7. UI aggiornata con nuovo messaggio

TEMPO TOTALE: ~1 secondo dopo la conferma (quasi real-time!)

INDEXED VS NON-INDEXED:

INDEXED:
  { "indexed": true, "name": "relayer", "type": "address" }
  → Il valore viene salvato nei TOPICS del log
  → FILTRABILE: puoi fare query tipo "tutti gli eventi dove relayer=0x1234"
  → LIMITE: max 3 parametri indexed per evento

NON-INDEXED:
  { "indexed": false, "name": "message", "type": "string" }
  → Il valore viene salvato nei DATA del log
  → NON filtrabile direttamente
  → Usato per dati grandi (string, array)

ESEMPIO PRATICO:

// Filtra solo eventi dove IL MIO indirizzo ha fatto relay
const { data: myRelays } = useWatchContractEvent({
  address: ZKBOARD_ADDRESS,
  abi: ZKBOARD_ABI,
  eventName: 'MessageRelayed',
  args: {
    relayer: myAddress  // Possibile perché relayer è indexed!
  }
})

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. PROBLEMA DELLA PROOF NELL'ABI relayRequests
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STORIA DI UN BUG RISOLTO:

CONTRATTO (Solidity):
  struct RelayRequest {
    uint256 merkleTreeRoot;
    uint256 nullifierHash;
    uint256[8] proof;        // ← ARRAY!
    string message;
    uint256 relayFee;
    address requester;
    bool executed;
  }
  mapping(uint256 => RelayRequest) public relayRequests;

COMPORTAMENTO SOLIDITY:
  → Quando rendi public un mapping di struct, Solidity genera un getter automatico
  → MA: Il getter OMETTE i campi array!
  → MOTIVO: Gli array possono essere molto grandi, leggere tutto sarebbe costoso

GETTER GENERATO AUTOMATICAMENTE:
  function relayRequests(uint256 id) public view returns (
    uint256 merkleTreeRoot,
    uint256 nullifierHash,
    // uint256[8] proof  ← OMESSO!
    string memory message,
    uint256 relayFee,
    address requester,
    bool executed
  )

BUG INIZIALE:
  → L'ABI in constants.ts includeva proof come output
  → Wagmi provava a decodificare 7 valori aspettandosene 8
  → ERRORE: "Position 319 is out of bounds"

FIX:
  → Rimossa la proof dall'outputs dell'ABI
  → Aggiustati gli indici nell'API route (/api/relay-request/route.ts)
  → message passato da index 3 a index 2
  → relayFee passato da index 4 a index 3
  → etc.

LEZIONE:
  → Solidity public getters ≠ struct completo
  → Sempre verificare l'ABI con il comportamento reale del contratto
  → Usare strumenti come cast (foundry) per testare:
    cast call 0xbB0d... "relayRequests(uint256)" 0

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6. COSTANTI ECONOMICHE E GAME THEORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Le costanti MIN_DEPOSIT, COST_PER_MESSAGE, DEFAULT_RELAY_FEE non sono casuali.
Sono il risultato di considerazioni economiche e di game theory.

A) MIN_DEPOSIT = 0.05 ETH

PERCHÉ COSÌ ALTO:
  - Anti-spam: creare identità costa 0.05 ETH → scoraggia bot spam
  - Sostenibilità: garantisce almeno 50 messaggi (0.05 / 0.001 = 50)
  - Commitment: mostra che l'utente è "serio" (skin in the game)

IN PRODUZIONE:
  - Potrebbe essere ridotto a 0.01 ETH (10 messaggi)
  - O implementare pricing dinamico basato su reputazione
  - O usare L2 (Optimism/Arbitrum) dove 0.05 ETH = ~$100 → troppo

B) COST_PER_MESSAGE = 0.001 ETH

CALCOLO:
  - Gas per relay: ~400k gas
  - Gas price Sepolia: ~15 gwei
  - Costo effettivo: 400k * 15 gwei = 0.006 ETH
  - Relayer guadagna: DEFAULT_RELAY_FEE = 0.001 ETH
  - Profitto relayer: 0.001 - 0.006 = -0.005 ETH (PERDITA!)

PERCHÉ È SOTTOCOSTO:
  - Progetto educativo, non produzione
  - Su Sepolia l'ETH è gratis (testnet)
  - Dimostra il concetto senza costi reali

IN PRODUZIONE:
  - COST_PER_MESSAGE dovrebbe essere >= costo relay + margine
  - Sepolia: 0.007 ETH
  - Mainnet (30 gwei): 0.015 ETH
  - L2 (0.1 gwei): 0.00004 ETH (molto più sostenibile!)

C) DEFAULT_RELAY_FEE = 0.001 ETH

ATTUALE SITUAZIONE:
  - Relayer perde 0.0005 ETH per relay
  - Nessun incentivo economico

MERCATO IDEALE:
  - Fee = costo gas * 1.1 (10% profitto)
  - Sepolia: 0.0066 ETH
  - Mainnet: 0.0132 ETH

DINAMICA DI MERCATO:
  - Se fee troppo bassa → nessun relayer → richieste non eseguite
  - Se fee troppo alta → utenti non creano richieste
  - Equilibrio: fee leggermente > costo gas

MIGLIORAMENTO POSSIBILE:
  - Fee dinamica basata sul gas price corrente
  - Funzione calculateMinRelayFee() che legge gas price on-chain
  - Utenti possono offrire fee più alta per priorità

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7. TIPO "as const" IN TYPESCRIPT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Perché scriviamo `as const` alla fine degli ABI?

SENZA `as const`:
  export const ZKBOARD_ABI = [...]
  // TypeScript inferirebbe tipo: Array<AbiItem>
  // Wagmi riceve tipo generico, perde informazioni

CON `as const`:
  export const ZKBOARD_ABI = [...] as const
  // TypeScript inferirebbe tipo: readonly [{ name: "groupId", ... }, ...]
  // Wagmi riceve tipo letterale, CONOSCE tutte le funzioni!

BENEFICIO:

SENZA:
  writeContract({
    functionName: 'postMessag'  // ← Typo! Ma TypeScript non lo rileva
  })

CON:
  writeContract({
    functionName: 'postMessag'  // ← ERRORE TypeScript:
    // Type '"postMessag"' is not assignable to type '"groupId" | "joinGroup" | "postMessage" | ...'
  })

ALTRO BENEFICIO - Type inference:

const { data } = useReadContract({
  abi: ZKBOARD_ABI,
  functionName: 'deposits',
  args: [address]
})
// TypeScript CONOSCE che data è di tipo bigint | undefined
// Autocomplete funziona perfettamente!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
8. COME AGGIORNARE DOPO UN NUOVO DEPLOY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SCENARIO: Hai modificato il contratto e vuoi fare un nuovo deploy.

STEP 1: DEPLOY
  npx hardhat run scripts/deploy.ts --network sepolia

OUTPUT:
  Deploying ZKBoard...
  ZKBoard deployed to: 0xNEW_ADDRESS_HERE
  Group ID: 1234567890

STEP 2: AGGIORNA constants.ts
  export const ZKBOARD_ADDRESS = "0xNEW_ADDRESS_HERE";
  export const FALLBACK_GROUP_ID = 1234567890;

STEP 3: SE HAI MODIFICATO IL CONTRATTO, AGGIORNA ABI
  // Opzione A: Manualmente (copia da artifacts)
  cat artifacts/contracts/ZKBoard.sol/ZKBoard.json | jq .abi

  // Opzione B: Script automatico
  cp artifacts/contracts/ZKBoard.sol/ZKBoard.json frontend/app/utils/ZKBoard.json
  // Poi importa in constants.ts

STEP 4: REBUILD FRONTEND
  cd frontend
  npm run build

STEP 5: TESTA
  npm run dev
  // Prova registrazione → post messaggio → relay

IMPORTANTE:
  - L'indirizzo vecchio NON funzionerà più (è un nuovo contratto!)
  - I dati del vecchio contratto rimangono sulla blockchain (immutabili)
  - Se vuoi migrare dati → devi scrivere script di migrazione

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
9. BEST PRACTICES PER CONSTANTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. NAMING CONVENTIONS:
   - UPPERCASE per costanti semplici (ZKBOARD_ADDRESS, MIN_DEPOSIT)
   - PascalCase per ABI (ZKBOARD_ABI, SEMAPHORE_ABI)
   - Descrittivi: DEFAULT_RELAY_FEE > FEE

2. COMMENTI:
   - Spiega PERCHÉ una costante ha quel valore
   - Documenta unità (ETH vs wei vs gwei)
   - Avvisa su valori temporanei/di test

3. VALIDAZIONE:
   - Aggiungi check runtime per indirizzi validi
   - Esempio: if (!isAddress(ZKBOARD_ADDRESS)) throw new Error(...)

4. ENVIRONMENT VARIABLES (miglioramento futuro):
   // .env.local
   NEXT_PUBLIC_ZKBOARD_ADDRESS=0xbB0d...
   NEXT_PUBLIC_NETWORK=sepolia

   // constants.ts
   export const ZKBOARD_ADDRESS = process.env.NEXT_PUBLIC_ZKBOARD_ADDRESS!

   BENEFICI:
   - Deploy su diversi network senza modificare codice
   - Secrets non nel codice (API keys, etc.)

5. TYPE SAFETY:
   - Usa `as const` per ABI
   - Definisci tipi custom dove ha senso
   - Esempio: type Network = 'sepolia' | 'mainnet'

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
10. DOMANDE FREQUENTI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Q1: Perché MIN_DEPOSIT, COST_PER_MESSAGE sono stringhe e non numeri?

A1: Perché in JavaScript i numeri hanno max 2^53
    0.05 ETH = 50000000000000000 wei (> 2^53!)
    Stringhe evitano overflow, poi convertiamo con parseEther()
    ESEMPIO: parseEther('0.05') → 50000000000000000n (BigInt)

Q2: Posso modificare le costanti a runtime?

A2: NO! Le costanti sono export const, quindi immutabili.
    Se serve modificarle → devi riavviare l'app
    Per valori dinamici → usa useState o context

Q3: Devo includere TUTTO l'ABI o solo le funzioni che uso?

A3: SOLO quelle che usi (ABI minimale)
    BENEFICI:
    - Bundle size più piccolo
    - Meno codice da mantenere
    - Type inference più veloce

    NOTA: In questo progetto includiamo tutte le funzioni usate,
          ma omettiamo quelle interne che non chiamiamo mai

Q4: Come ottengo l'ABI di un contratto già deployato?

A4: OPZIONE A: Se hai il codice sorgente
    → artifacts/contracts/ZKBoard.sol/ZKBoard.json

    OPZIONE B: Se è verificato su Etherscan
    → https://sepolia.etherscan.io/address/0xbB0d.../contract
    → Tab "Contract" → "ABI"

    OPZIONE C: Strumenti CLI
    → cast interface 0xbB0d... (foundry)
    → Genera ABI automaticamente

Q5: Perché FALLBACK_GROUP_ID è un numero così strano (1767286984)?

A5: È generato casualmente dal contratto durante il deploy
    CALCOLO: uint256(keccak256(abi.encodePacked(address(this), block.timestamp)))
    SCOPO: ID univoco per evitare collisioni tra deployment diversi

    Se rideploy → ID cambia → devi aggiornare la costante!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINE SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
*/
