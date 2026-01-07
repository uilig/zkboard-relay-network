/*
 * ═══════════════════════════════════════════════════════════════════════
 * SCRIPT DI DEPLOYMENT - ZKBOARD RELAY NETWORK
 * ═══════════════════════════════════════════════════════════════════════
 *
 * DESCRIZIONE:
 * Questo script deploya l'intero stack della ZKBoard Relay Network su
 * Sepolia testnet (o qualsiasi altra rete Ethereum compatibile).
 *
 * STACK COMPLETO (in ordine di deployment):
 * 1. SemaphoreVerifier - Contratto per verifica proof ZK Groth16
 * 2. Poseidon T3 - Hash function ZK-friendly (usa contratto esistente)
 * 3. Semaphore - Contratto per gestione identità anonime e gruppi
 * 4. ZKBoard - Contratto principale della bacheca messaggi
 *
 * TECNOLOGIE UTILIZZATE:
 * - Hardhat: Framework di sviluppo Ethereum
 * - Ethers.js v6: Libreria per interazione con Ethereum
 * - TypeScript: Linguaggio tipizzato per JavaScript
 *
 * PREREQUISITI:
 * 1. File .env configurato con:
 *    - SEPOLIA_RPC_URL: URL del nodo Sepolia (Infura/Alchemy)
 *    - PRIVATE_KEY: Chiave privata del deployer (senza 0x)
 *
 * 2. Balance ETH sufficiente:
 *    - Sepolia testnet: ~0.1 ETH (gas per deployment)
 *    - Mainnet: ~$200-500 USD (a seconda del gas price)
 *
 * 3. Contratto Poseidon già deployato su Sepolia:
 *    - Indirizzo: 0xB43122Ecb241DD50062641f089876679fd06599a
 *    - Source: Semaphore v4 official deployment
 *
 * ESECUZIONE:
 * npx hardhat run scripts/deploy.ts --network sepolia
 *
 * OUTPUT:
 * - Indirizzi dei contratti deployati
 * - Group ID generato
 * - Istruzioni per aggiornare il frontend
 *
 * GAS COSTS STIMATI (Sepolia, 15 gwei):
 * - SemaphoreVerifier: ~3M gas (~$10-20 equivalente mainnet)
 * - Semaphore: ~2M gas (~$7-15 equivalente mainnet)
 * - ZKBoard: ~1.5M gas (~$5-10 equivalente mainnet)
 * - initializeBoard: ~500k gas (~$2-5 equivalente mainnet)
 * TOTALE: ~7M gas (~$25-50 su mainnet a 15 gwei)
 *
 * SICUREZZA:
 * ⚠️ IMPORTANTE: NON committare MAI il file .env con chiavi private reali!
 * ⚠️ Usa un wallet dedicato per deployment, non il wallet principale
 * ⚠️ Verifica gli indirizzi deployati prima di usarli in produzione
 */

// ═══════════════════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════════════════

/*
 * ethers: Libreria principale per interazione con Ethereum
 *
 * Importato da "hardhat" invece di "ethers" direttamente perché:
 * - Hardhat inietta automaticamente la configurazione di rete
 * - Include i contratti compilati
 * - Gestisce automaticamente i provider (RPC connection)
 * - Offre utilities di debugging
 */
import { ethers } from "hardhat";

// ═══════════════════════════════════════════════════════════════════════
// FUNZIONE PRINCIPALE DI DEPLOYMENT
// ═══════════════════════════════════════════════════════════════════════

/**
 * main() - Funzione principale che esegue il deployment completo
 *
 * FLUSSO:
 * 1. Setup: Ottiene deployer e verifica balance
 * 2. Step 1: Deploya SemaphoreVerifier (verifica proof ZK)
 * 3. Step 2: Deploya Semaphore (gestione gruppi e identità)
 * 4. Step 3: Deploya ZKBoard (bacheca messaggi)
 * 5. Step 4: Inizializza ZKBoard (crea gruppo Semaphore)
 * 6. Step 5: Verifica deployment (controlli di sanità)
 * 7. Summary: Mostra indirizzi e istruzioni
 *
 * ASYNC/AWAIT:
 * Tutte le operazioni blockchain sono asincrone perché:
 * - Richiedono transazioni on-chain
 * - Devono attendere conferme
 * - Comunicano via RPC con il nodo
 */
async function main() {
  // ═══════════════════════════════════════════════════════════════════
  // SETUP INIZIALE
  // ═══════════════════════════════════════════════════════════════════

  console.log("🚀 Deploying Complete ZK Anonymous Board Stack\n");
  console.log("=".repeat(60));

  /*
   * getSigners() - Ottiene gli account disponibili dal provider
   *
   * In Hardhat:
   * - Su localhost: Ritorna 20 account hardcoded (per testing)
   * - Su testnet/mainnet: Ritorna account da PRIVATE_KEY nel .env
   *
   * [deployer] - Destructuring: prende il primo signer
   * Questo sarà l'account che paga il gas per tutte le transazioni
   */
  const [deployer] = await ethers.getSigners();
  console.log("📍 Deployer address:", deployer.address);

  /*
   * getBalance() - Ottiene il balance ETH dell'account deployer
   *
   * ethers.provider: Connessione al nodo Ethereum (RPC)
   * await: Aspetta la risposta dal nodo
   * formatEther(): Converte wei (unità base) in ETH leggibile
   *
   * UNITÀ ETHEREUM:
   * - 1 ETH = 10^18 wei
   * - formatEther(1000000000000000000) = "1.0" ETH
   */
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Balance:", ethers.formatEther(balance), "ETH\n");

  /*
   * POSEIDON T3 - Contratto Poseidon già deployato su Sepolia
   *
   * PERCHÉ NON LO DEPLOYAMO:
   * - Poseidon è standard e immutabile
   * - Semaphore v4 ha già deployato una versione su tutte le reti
   * - Riusare lo stesso contratto risparmia gas
   * - Garantisce compatibilità con altri progetti Semaphore
   *
   * SOURCE:
   * https://github.com/semaphore-protocol/semaphore/tree/main/packages/contracts
   *
   * VERIFICA:
   * Puoi vedere il contratto su:
   * https://sepolia.etherscan.io/address/0xB43122Ecb241DD50062641f089876679fd06599a
   */
  const POSEIDON_T3 = "0xB43122Ecb241DD50062641f089876679fd06599a";
  console.log("📦 Using existing Poseidon T3:", POSEIDON_T3);
  console.log("");

  // ═══════════════════════════════════════════════════════════════════
  // STEP 1: DEPLOY SEMAPHOREVERIFIER
  // ═══════════════════════════════════════════════════════════════════

  console.log("=".repeat(60));
  console.log("STEP 1: Deploying SemaphoreVerifier");
  console.log("=".repeat(60));
  console.log("");

  /*
   * SEMAPHOREVERIFIER - Contratto generato da snarkjs
   *
   * COSA FA:
   * Verifica proof ZK Groth16 on-chain usando pairing crittografici
   *
   * COME È STATO GENERATO:
   * 1. Circuito Semaphore scritto in Circom
   * 2. Compilato con circom compiler → .r1cs + .wasm
   * 3. Setup phase con snarkjs → proving key + verification key
   * 4. snarkjs genera Verifier.sol dalla verification key
   * 5. Rinominato in SemaphoreVerifier.sol
   *
   * DIMENSIONE:
   * - ~500 linee di codice Solidity
   * - ~3M gas per deployment (contratto grande)
   * - Contiene parametri hardcoded della curva BN254
   *
   * IMMUTABILITÀ:
   * Una volta deployato, il Verifier non può essere modificato.
   * Se cambi il circuito, devi deployare un nuovo Verifier.
   */

  /*
   * getContractFactory() - Ottiene la "factory" del contratto
   *
   * Una factory è un oggetto che può deployare istanze del contratto.
   * Hardhat carica automaticamente:
   * - Il bytecode compilato (da artifacts/)
   * - L'ABI (interface del contratto)
   * - Il deployer signer (chi paga il gas)
   *
   * "SemaphoreVerifier" deve corrispondere al nome del file .sol
   */
  const SemaphoreVerifier = await ethers.getContractFactory("SemaphoreVerifier");

  /*
   * deploy() - Deploya il contratto sulla blockchain
   *
   * COSA SUCCEDE:
   * 1. Hardhat crea una transaction con:
   *    - data: bytecode del contratto
   *    - from: deployer.address
   *    - gas: stimato automaticamente
   * 2. Transaction viene firmata con deployer private key
   * 3. Transaction viene inviata al nodo RPC
   * 4. Nodo la propaga alla rete Ethereum
   * 5. Miners la includono in un blocco
   *
   * TEMPO:
   * - Localhost: istantaneo (auto-mining)
   * - Sepolia: ~15 secondi (block time)
   * - Mainnet: ~12 secondi (block time)
   *
   * GAS COST: ~3M gas (~$10-20 su mainnet a 15 gwei)
   */
  const verifier = await SemaphoreVerifier.deploy();

  /*
   * waitForDeployment() - Aspetta che il deployment sia confermato
   *
   * PERCHÉ È NECESSARIO:
   * deploy() invia la transaction ma non aspetta la conferma.
   * Dobbiamo aspettare che il contratto sia effettivamente on-chain
   * prima di poter interagire con esso.
   *
   * CONFERME:
   * - Default: 1 conferma (blocco incluso)
   * - Produzione: 2-6 conferme (maggiore sicurezza)
   *
   * TEMPO: ~15 secondi su Sepolia, ~12 secondi su mainnet
   */
  await verifier.waitForDeployment();

  /*
   * getAddress() - Ottiene l'indirizzo del contratto deployato
   *
   * L'indirizzo è calcolato deterministicamente da:
   * - Indirizzo del deployer
   * - Nonce del deployer (numero di transazioni inviate)
   *
   * FORMULA (semplificata):
   * address = keccak256(deployerAddress, nonce)[12:32]
   *
   * ESEMPIO:
   * deployer: 0x1234...5678
   * nonce: 42
   * address: 0x9abc...def0 (indirizzo del contratto)
   */
  const verifierAddress = await verifier.getAddress();

  console.log("✅ SemaphoreVerifier deployed at:", verifierAddress);
  console.log("");

  // ═══════════════════════════════════════════════════════════════════
  // STEP 2: DEPLOY SEMAPHORE
  // ═══════════════════════════════════════════════════════════════════

  console.log("=".repeat(60));
  console.log("STEP 2: Deploying Our Custom Semaphore");
  console.log("=".repeat(60));
  console.log("");

  /*
   * CONFIGURAZIONE SEMAPHORE
   *
   * Il contratto Semaphore richiede due parametri nel constructor:
   * 1. verifierAddress: Indirizzo del SemaphoreVerifier (appena deployato)
   * 2. POSEIDON_T3: Indirizzo del contratto Poseidon (esistente)
   *
   * Questi contratti saranno chiamati da Semaphore per:
   * - Calcolare hash Merkle tree (Poseidon)
   * - Verificare proof ZK (Verifier)
   */
  console.log("Configuration:");
  console.log("   Verifier:", verifierAddress);
  console.log("   Poseidon:", POSEIDON_T3);
  console.log("");

  /*
   * SEMAPHORE CONTRACT DEPLOYMENT
   *
   * Contratto Semaphore compatibile con la versione 3 del protocollo.
   *
   * FUNZIONALITÀ:
   * - Gestione gruppi con identità anonime
   * - Merkle tree con hash function Poseidon
   * - Verifica completa di proof ZK Groth16
   * - Compatibilità con circuiti Semaphore standard
   *
   * GAS COST: ~2M gas (~$7-15 su mainnet a 15 gwei)
   */
  const Semaphore = await ethers.getContractFactory("Semaphore");

  /*
   * deploy(verifierAddress, POSEIDON_T3)
   *
   * Passa i parametri al constructor del contratto Semaphore:
   *
   * constructor(address _verifier, address _poseidon) {
   *     verifier = ISemaphoreVerifier(_verifier);
   *     poseidon = IPoseidonT3(_poseidon);
   * }
   *
   * Questi indirizzi vengono salvati nello storage del contratto
   * e usati per tutte le operazioni future.
   */
  const semaphore = await Semaphore.deploy(verifierAddress, POSEIDON_T3);
  await semaphore.waitForDeployment();
  const semaphoreAddress = await semaphore.getAddress();

  console.log("✅ Semaphore deployed at:", semaphoreAddress);
  console.log("");

  // ═══════════════════════════════════════════════════════════════════
  // STEP 3: DEPLOY ZKBOARD
  // ═══════════════════════════════════════════════════════════════════

  console.log("=".repeat(60));
  console.log("STEP 3: Deploying ZKBoard with Relay System");
  console.log("=".repeat(60));
  console.log("");

  /*
   * GROUP_ID - Identificatore univoco del gruppo Semaphore
   *
   * GENERAZIONE:
   * Usiamo il timestamp Unix corrente come ID gruppo.
   *
   * Date.now() - millisecondi dal 1970
   * / 1000 - converti in secondi
   * Math.floor() - rimuovi decimali
   *
   * ESEMPIO:
   * 2026-01-01 12:00:00 UTC → 1735732800
   *
   * PERCHÉ TIMESTAMP:
   * - Garantisce unicità (ogni deployment ha un ID diverso)
   * - Facile da ricordare/debuggare (è una data)
   * - Compatibile con Semaphore (accetta qualsiasi uint256)
   *
   * ALTERNATIVE:
   * - Numero fisso: 1, 2, 3... (rischio collisioni)
   * - Random: Math.floor(Math.random() * 1e18) (meno tracciabile)
   * - Hash: keccak256(projectName) (più complesso)
   */
  const GROUP_ID = Math.floor(Date.now() / 1000);
  console.log("Group ID:", GROUP_ID);
  console.log("");

  /*
   * ZKBOARD CONTRACT DEPLOYMENT
   *
   * ZKBoard è il contratto principale della nostra applicazione.
   * Implementa:
   * - Sistema di depositi (joinGroupWithDeposit)
   * - Relay network (createRelayRequest, executeRelay)
   * - Bacheca messaggi (messages array)
   * - Moderazione comunitaria (reportMessage)
   *
   * PARAMETRI CONSTRUCTOR:
   * - semaphoreAddress: Indirizzo del contratto Semaphore
   * - GROUP_ID: ID del gruppo Semaphore da usare
   *
   * Il constructor NON crea il gruppo, solo lo inizializza.
   * Il gruppo verrà creato da initializeBoard() nello step 4.
   *
   * GAS COST: ~1.5M gas (~$5-10 su mainnet a 15 gwei)
   */
  const ZKBoard = await ethers.getContractFactory("ZKBoard");
  const zkBoard = await ZKBoard.deploy(semaphoreAddress, GROUP_ID);
  await zkBoard.waitForDeployment();
  const zkBoardAddress = await zkBoard.getAddress();

  console.log("✅ ZKBoard deployed at:", zkBoardAddress);
  console.log("");

  // ═══════════════════════════════════════════════════════════════════
  // STEP 4: INITIALIZE BOARD
  // ═══════════════════════════════════════════════════════════════════

  console.log("=".repeat(60));
  console.log("STEP 4: Initializing Board");
  console.log("=".repeat(60));
  console.log("");

  /*
   * INITIALIZE BOARD - Creazione del gruppo Semaphore
   *
   * COSA FA initializeBoard():
   * 1. Verifica che non sia già inizializzato
   * 2. Chiama semaphore.createGroup(groupId, 20, address(this))
   * 3. Crea un Merkle tree di profondità 20 (max 1M membri)
   * 4. Setta ZKBoard stesso come admin del gruppo
   *
   * PERCHÉ IN DUE STEP (deploy + initialize):
   * - Separazione delle responsabilità (deployment vs setup)
   * - Permette di verificare il deployment prima di inizializzare
   * - Pattern comune in contratti complessi (vedi OpenZeppelin)
   *
   * ALTERNATIVE:
   * Potremmo chiamare createGroup() direttamente nel constructor,
   * ma questo:
   * - Aumenterebbe il costo del deployment
   * - Renderebbe il deployment atomico (fallisce tutto o niente)
   * - Ridurrebbe flessibilità (non puoi deployare senza inizializzare)
   *
   * GAS COST: ~500k gas (~$2-5 su mainnet a 15 gwei)
   * Costo alto perché calcola tutti i 20 livelli di zero dell'albero
   */
  console.log("⏳ Calling initializeBoard...");

  /*
   * zkBoard.initializeBoard() - Chiama la funzione on-chain
   *
   * COSA SUCCEDE:
   * 1. Hardhat crea una transaction:
   *    - to: zkBoardAddress
   *    - data: keccak256("initializeBoard()")[0:4] (function selector)
   *    - from: deployer.address
   * 2. Transaction firmata e inviata
   * 3. Miners eseguono la funzione on-chain
   * 4. Stato del contratto viene aggiornato
   *
   * RETURN VALUE:
   * Una "TransactionResponse" che contiene:
   * - hash: hash della transaction
   * - from, to, data, value, gas...
   * - wait(): metodo per aspettare conferme
   */
  const initTx = await zkBoard.initializeBoard();

  console.log("   Transaction hash:", initTx.hash);

  /*
   * wait() - Aspetta che la transaction sia inclusa in un blocco
   *
   * CONFERME:
   * - wait() = wait(1) = aspetta 1 conferma
   * - wait(3) = aspetta 3 conferme (più sicuro)
   *
   * RETURN VALUE:
   * Una "TransactionReceipt" che contiene:
   * - blockNumber: numero del blocco
   * - gasUsed: gas effettivamente consumato
   * - logs: eventi emessi
   * - status: 1 = success, 0 = failed
   *
   * TEMPO: ~15 secondi su Sepolia
   */
  await initTx.wait();

  console.log("✅ Board initialized!");
  console.log("");

  // ═══════════════════════════════════════════════════════════════════
  // STEP 5: VERIFY DEPLOYMENT
  // ═══════════════════════════════════════════════════════════════════

  console.log("=".repeat(60));
  console.log("STEP 5: Verifying Deployment");
  console.log("=".repeat(60));
  console.log("");

  /*
   * DEPLOYMENT VERIFICATION - Sanity checks
   *
   * Leggiamo le variabili pubbliche del contratto per verificare
   * che il deployment sia andato a buon fine.
   *
   * CHIAMATE VIEW FUNCTIONS:
   * Queste sono chiamate "read-only" che:
   * - Non modificano lo stato
   * - Non costano gas
   * - Sono eseguite localmente dal nodo RPC
   * - Ritornano immediatamente (no mining)
   *
   * PERCHÉ È IMPORTANTE:
   * - Verifica che i valori di default siano corretti
   * - Conferma che l'inizializzazione sia riuscita
   * - Debugging: se qualcosa è sbagliato, lo scopriamo subito
   */

  /*
   * groupId() - Legge la variabile pubblica groupId
   *
   * In Solidity:
   * uint256 public groupId;
   *
   * Il compilatore genera automaticamente un getter:
   * function groupId() external view returns (uint256)
   *
   * TIPO RITORNO:
   * BigInt (numero grande JavaScript)
   * Serve per rappresentare uint256 (fino a 2^256)
   */
  const groupId = await zkBoard.groupId();

  /*
   * MIN_DEPOSIT() - Legge la costante MIN_DEPOSIT
   *
   * In Solidity:
   * uint256 public constant MIN_DEPOSIT = 0.05 ether;
   *
   * VALORE:
   * 0.05 ETH = 50000000000000000 wei
   *
   * Questo è il deposito minimo richiesto per unirsi al gruppo
   */
  const minDeposit = await zkBoard.MIN_DEPOSIT();

  /*
   * COST_PER_MESSAGE() - Costo per creare un messaggio
   *
   * In Solidity:
   * uint256 public constant COST_PER_MESSAGE = 0.005 ether;
   *
   * VALORE:
   * 0.005 ETH = 5000000000000000 wei
   *
   * Ogni messaggio "consuma" 0.005 ETH di credito.
   * Con MIN_DEPOSIT di 0.05 ETH, un utente può postare 10 messaggi.
   */
  const costPerMsg = await zkBoard.COST_PER_MESSAGE();

  /*
   * nextRequestId() - Prossimo ID relay request
   *
   * In Solidity:
   * uint256 public nextRequestId = 0;
   *
   * VALORE ATTESO: 0 (nessuna request creata ancora)
   *
   * Incrementa ogni volta che viene creata una relay request.
   */
  const nextReqId = await zkBoard.nextRequestId();

  /*
   * messageCount() - Numero totale di messaggi postati
   *
   * In Solidity:
   * uint256 public messageCount = 0;
   *
   * VALORE ATTESO: 0 (nessun messaggio ancora)
   *
   * Incrementa ogni volta che un messaggio viene postato con successo.
   */
  const msgCount = await zkBoard.messageCount();

  /*
   * PRINT VERIFICATION RESULTS
   *
   * toString(): Converte BigInt in stringa leggibile
   * formatEther(): Converte wei in ETH (divide per 10^18)
   */
  console.log("✓ Group ID:", groupId.toString());
  console.log("✓ Min Deposit:", ethers.formatEther(minDeposit), "ETH");
  console.log("✓ Cost per Message:", ethers.formatEther(costPerMsg), "ETH");
  console.log("✓ Next Request ID:", nextReqId.toString());
  console.log("✓ Message Count:", msgCount.toString());
  console.log("");

  // ═══════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════

  console.log("=".repeat(60));
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("=".repeat(60));
  console.log("");

  /*
   * DEPLOYMENT SUMMARY
   *
   * Stampa tutti gli indirizzi dei contratti deployati.
   * Questi indirizzi sono permanenti e immutabili.
   *
   * IMPORTANTE:
   * - Salvare questi indirizzi in un file sicuro
   * - Copiarli nel frontend (constants.ts)
   * - Verificarli su Etherscan
   * - Tenerli per reference futura
   */
  console.log("📝 Contract Addresses:");
  console.log("   SemaphoreVerifier:", verifierAddress);
  console.log("   Poseidon T3:", POSEIDON_T3, "(existing)");
  console.log("   Semaphore:", semaphoreAddress);
  console.log("   ZKBoard:", zkBoardAddress);
  console.log("");
  console.log("🆔 Group ID:", GROUP_ID);
  console.log("");

  // ═══════════════════════════════════════════════════════════════════
  // FRONTEND UPDATE INSTRUCTIONS
  // ═══════════════════════════════════════════════════════════════════

  /*
   * ISTRUZIONI PER AGGIORNARE IL FRONTEND
   *
   * Dopo il deployment, il frontend deve essere aggiornato con:
   * 1. ZKBOARD_ADDRESS: Indirizzo del contratto ZKBoard
   * 2. FALLBACK_GROUP_ID: ID del gruppo Semaphore
   *
   * PERCHÉ:
   * Il frontend usa questi valori per:
   * - Connettersi al contratto giusto (ZKBOARD_ADDRESS)
   * - Generare proof con il gruppo corretto (GROUP_ID)
   * - Leggere messaggi e stato dalla blockchain
   *
   * FILE DA MODIFICARE:
   * frontend/app/utils/constants.ts
   *
   * NOTA:
   * Il path mostrato "zkboard-frontend" è obsoleto.
   * Il path corretto dopo il cleanup è "frontend".
   */
  console.log("=".repeat(60));
  console.log(" 🔧 UPDATE FRONTEND CONFIGURATION ");
  console.log("=".repeat(60));
  console.log("");
  console.log("File: frontend/app/utils/constants.ts");
  console.log("");
  console.log(`export const ZKBOARD_ADDRESS = "${zkBoardAddress}";`);
  console.log(`export const FALLBACK_GROUP_ID = ${GROUP_ID};`);
  console.log("");
  console.log("=".repeat(60));
  console.log("");

  /*
   * NEXT STEPS - Istruzioni post-deployment
   *
   * 1. UPDATE CONSTANTS:
   *    Copia gli indirizzi nel file constants.ts del frontend
   *
   * 2. CLEAR LOCALSTORAGE:
   *    Il frontend salva identity e group members in localStorage.
   *    Dopo un redeploy, questi dati sono obsoleti e devono essere cancellati.
   *    Browser DevTools → Application → Local Storage → Clear
   *
   * 3. TEST REGISTRATION:
   *    Prova a registrarti con un deposito minimo (0.05 ETH)
   *    Verifica che l'identità venga aggiunta al gruppo
   *
   * 4. TEST RELAY SYSTEM:
   *    Crea una relay request, poi eseguila
   *    Verifica che il messaggio venga postato e il relayer pagato
   */
  console.log("📝 Next steps:");
  console.log("   1. Update constants in frontend (see above)");
  console.log("   2. Clear browser localStorage");
  console.log("   3. Test registration with deposit");
  console.log("   4. Test relay system");
  console.log("");

  console.log("🎉 Full stack deployed successfully!\n");
}

// ═══════════════════════════════════════════════════════════════════════
// SCRIPT EXECUTION
// ═══════════════════════════════════════════════════════════════════════

/*
 * SCRIPT ENTRY POINT
 *
 * Questo pattern è standard per script Node.js/Hardhat:
 *
 * main()
 *   .then(() => process.exit(0))   // Success: exit code 0
 *   .catch((error) => { ... })      // Error: exit code 1
 *
 * PERCHÉ:
 * - main() è async, ritorna una Promise
 * - .then() viene chiamato se la Promise si risolve (success)
 * - .catch() viene chiamato se la Promise viene rigettata (error)
 * - process.exit() termina il processo Node.js con un exit code
 *
 * EXIT CODES:
 * - 0: Success (tutto ok)
 * - 1: Error (qualcosa è andato storto)
 *
 * Questo è importante per:
 * - CI/CD pipelines (check if deployment succeeded)
 * - Scripting (chain multiple commands)
 * - Error tracking (log failed deployments)
 */
main()
  .then(() => process.exit(0))
  .catch((error) => {
    /*
     * ERROR HANDLING
     *
     * Se qualsiasi operazione nel main() fallisce:
     * 1. Viene lanciata un'eccezione
     * 2. Il .catch() la cattura
     * 3. Stampiamo l'errore sulla console
     * 4. Terminiamo con exit code 1 (failure)
     *
     * ERRORI COMUNI:
     * - Insufficient funds: Balance troppo basso per pagare gas
     * - Invalid nonce: Transazioni out of order
     * - Contract creation failed: Errore nel constructor
     * - Revert: Require statement fallito nel contratto
     * - Network error: Impossibile connettersi al nodo RPC
     *
     * DEBUGGING:
     * L'oggetto error contiene:
     * - message: Descrizione dell'errore
     * - stack: Stack trace (dove è successo)
     * - code: Codice errore (es: INSUFFICIENT_FUNDS)
     */
    console.error("\n❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });

/*
 * ═══════════════════════════════════════════════════════════════════════
 * RIASSUNTO SCRIPT DEPLOYMENT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * SCOPO:
 * Questo script deploya l'intero stack della ZKBoard Relay Network su
 * Ethereum (Sepolia testnet o mainnet).
 *
 * CONTRATTI DEPLOYATI:
 *
 * 1. SemaphoreVerifier (~3M gas):
 *    - Generato automaticamente da snarkjs
 *    - Verifica proof Groth16 on-chain
 *    - Usa pairing crittografici BN254
 *    - Immutabile (parametri hardcoded)
 *
 * 2. Semaphore (~2M gas):
 *    - Gestisce gruppi e identità anonime
 *    - Implementa Merkle tree con Poseidon hash
 *    - Verifica proof tramite SemaphoreVerifier
 *    - Mantiene storico root per flessibilità
 *
 * 3. ZKBoard (~1.5M gas):
 *    - Contratto principale della bacheca
 *    - Sistema depositi e crediti
 *    - Relay network decentralizzato
 *    - Moderazione comunitaria
 *
 * 4. initializeBoard (~500k gas):
 *    - Crea gruppo Semaphore (depth=20, max 1M membri)
 *    - Calcola albero di zeri
 *    - Setta ZKBoard come admin
 *
 * TOTALE GAS: ~7M gas (~$25-50 su mainnet a 15 gwei)
 *
 * FLUSSO DEPLOYMENT:
 *
 * 1. SETUP:
 *    - Carica deployer account da .env
 *    - Verifica balance ETH
 *    - Usa Poseidon esistente (non redeploy)
 *
 * 2. DEPLOY CONTRACTS:
 *    - SemaphoreVerifier (verifica ZK)
 *    - Semaphore (linking Verifier + Poseidon)
 *    - ZKBoard (linking Semaphore + groupId)
 *
 * 3. INITIALIZE:
 *    - Crea gruppo Semaphore
 *    - ZKBoard diventa admin del gruppo
 *
 * 4. VERIFY:
 *    - Legge variabili pubbliche
 *    - Conferma valori corretti
 *
 * 5. OUTPUT:
 *    - Indirizzi contratti
 *    - Group ID
 *    - Istruzioni frontend
 *
 * TECNOLOGIE:
 *
 * - Hardhat: Framework Ethereum development
 *   → Compila, deploya, testa contratti
 *   → Gestisce network configuration
 *   → Integra con ethers.js
 *
 * - Ethers.js v6: Libreria Ethereum JavaScript
 *   → Crea e firma transazioni
 *   → Interagisce con contratti
 *   → Gestisce wallet e providers
 *
 * - TypeScript: Linguaggio tipizzato
 *   → Type safety (meno errori)
 *   → Autocompletamento IDE
 *   → Migliore maintainability
 *
 * DEPLOYMENT REQUIREMENTS:
 *
 * 1. FILE .env:
 *    SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_API_KEY
 *    PRIVATE_KEY=your_private_key_without_0x
 *
 * 2. BALANCE ETH:
 *    - Testnet: ~0.1 ETH (free da faucet)
 *    - Mainnet: ~$200-500 USD
 *
 * 3. POSEIDON CONTRACT:
 *    - Già deployato su Sepolia
 *    - Indirizzo: 0xB43122Ecb241DD50062641f089876679fd06599a
 *    - Source: Semaphore v4 official
 *
 * ESECUZIONE:
 *
 * # Testnet (recommended)
 * npx hardhat run scripts/deploy.ts --network sepolia
 *
 * # Mainnet (ATTENZIONE: costa vero denaro!)
 * npx hardhat run scripts/deploy.ts --network mainnet
 *
 * # Localhost (per testing)
 * npx hardhat node  # terminal 1
 * npx hardhat run scripts/deploy.ts --network localhost  # terminal 2
 *
 * POST-DEPLOYMENT:
 *
 * 1. Salva indirizzi in constants.ts del frontend
 * 2. Verifica contratti su Etherscan (opzionale):
 *    npx hardhat verify --network sepolia ADDRESS CONSTRUCTOR_ARGS
 * 3. Clear browser localStorage
 * 4. Testa registrazione e relay system
 *
 * SICUREZZA:
 *
 * ⚠️ NON committare file .env con chiavi private!
 * ⚠️ Usa wallet dedicato per deployment
 * ⚠️ Verifica indirizzi prima di usarli
 * ⚠️ Test su testnet prima di mainnet
 * ⚠️ Double-check gas price prima di deployare
 *
 * TROUBLESHOOTING:
 *
 * Error: Insufficient funds
 * → Verifica balance con: npx hardhat run scripts/check-balance.ts
 *
 * Error: Nonce too low
 * → Reset nonce: https://metamask.zendesk.com/hc/en-us/articles/360015489251
 *
 * Error: Contract creation failed
 * → Check constructor args e compiled contracts
 *
 * Error: Network error
 * → Verifica RPC URL e connessione internet
 *
 * VERIFICA DEPLOYMENT:
 *
 * 1. Etherscan:
 *    https://sepolia.etherscan.io/address/YOUR_CONTRACT_ADDRESS
 *
 * 2. Hardhat console:
 *    npx hardhat console --network sepolia
 *    const zkBoard = await ethers.getContractAt("ZKBoard", "ADDRESS")
 *    await zkBoard.groupId()
 *
 * 3. Frontend:
 *    Aggiorna constants.ts e testa UI
 *
 * COSTI REALI (mainnet, 15 gwei, ETH = $2000):
 *
 * - SemaphoreVerifier: 3M gas = 0.045 ETH = $90
 * - Semaphore: 2M gas = 0.03 ETH = $60
 * - ZKBoard: 1.5M gas = 0.0225 ETH = $45
 * - initializeBoard: 500k gas = 0.0075 ETH = $15
 *
 * TOTALE: ~7M gas = ~0.105 ETH = ~$210
 *
 * NOTA:
 * Su L2 (Arbitrum, Optimism) i costi sarebbero ~10-100x inferiori:
 * - Arbitrum: ~$2-5
 * - Optimism: ~$5-10
 * - Base: ~$3-7
 *
 * ALTERNATIVE DEPLOYMENT:
 *
 * 1. Hardhat Ignition:
 *    Nuovo sistema di deployment di Hardhat
 *    Più robusto, con retry automatici
 *
 * 2. Foundry Script:
 *    Solidity-based deployment
 *    Più veloce, meno dipendenze JavaScript
 *
 * 3. Manual deployment:
 *    Remix IDE + MetaMask
 *    Più semplice, meno automatizzato
 */
