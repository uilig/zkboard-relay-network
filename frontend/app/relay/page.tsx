/*
╔═══════════════════════════════════════════════════════════════════════════════╗
║                            🔄 RELAY DASHBOARD                                 ║
║                                                                               ║
║  Pagina per i RELAYER: utenti che eseguono le richieste di relay per conto    ║
║  di altri utenti che non hanno ETH per pagare il gas.                         ║
║                                                                               ║
║  SCOPO:                                                                       ║
║  - Mostrare tutte le richieste di relay pending (non ancora eseguite)         ║
║  - Permettere ai relayer di eseguirle cliccando un bottone                    ║
║  - I relayer pagano il gas (~0.0015 ETH) ma guadagnano la relay fee (~0.001)  ║
║                                                                               ║
║  FUNZIONAMENTO DEL SISTEMA DI RELAY:                                          ║
║                                                                               ║
║  1. UTENTE SENZA ETH:                                                         ║
║     - Ha un'identità Semaphore e vuole postare                                ║
║     - Genera la proof ZK (client-side, gratis)                                ║
║     - Chiama createRelayRequest() invece di postMessage()                     ║
║     - La richiesta viene salvata on-chain (gas basso: ~50k)                   ║
║                                                                               ║
║  2. RELAYER (questa pagina):                                                  ║
║     - Monitora le richieste pending                                           ║
║     - Vede la relay fee offerta                                               ║
║     - Sceglie quale eseguire (ordinate per fee decrescente)                   ║
║     - Chiama executeRelay(requestId) pagando il gas                           ║
║     - Guadagna la relay fee come compenso                                     ║
║                                                                               ║
║  3. CONTRATTO:                                                                ║
║     - Verifica la proof ZK                                                    ║
║     - Emette l'evento MessagePosted                                           ║
║     - Trasferisce la fee al relayer                                           ║
║     - Marca la richiesta come executed                                        ║
║                                                                               ║
║  INCENTIVI ECONOMICI:                                                         ║
║  Gas per relay: ~400k gas = ~0.0015 ETH (a 15 gwei)                           ║
║  Fee tipica: 0.001 ETH                                                        ║
║  Profitto: -0.0005 ETH (perdita!)                                             ║
║                                                                               ║
║                                                                               ║
║  FILE: frontend/app/relay/page.tsx                                            ║
║  DIPENDENZE: Wagmi v2, RainbowKit, API route /api/relay-request               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
*/

'use client'; // Direttiva Next.js 14: questo è un Client Component (può usare useState, onClick, etc.)

// ============================================================================
// IMPORT DELLE LIBRERIE
// ============================================================================

// React hooks per stato e side effects
import { useState, useEffect } from 'react';
// useState: per gestire lo stato locale (requests array, contatore relayed)
// useEffect: per caricare le richieste quando cambia nextRequestId

// RainbowKit: UI componente per connettere il wallet (MetaMask, WalletConnect, etc.)
import { ConnectButton } from '@rainbow-me/rainbowkit';

// Wagmi v2: Libreria React per interagire con Ethereum
import {
  useAccount,                  // Hook per ottenere l'indirizzo connesso e lo stato di connessione
  useReadContract,             // Hook per leggere dati dai contratti (view functions)
  useWriteContract,            // Hook per scrivere sui contratti (state-changing functions)
  useWatchContractEvent,       // Hook per ascoltare eventi del contratto in tempo reale
  useWaitForTransactionReceipt,// Hook per attendere la conferma della transazione
} from 'wagmi';

// Viem: Libreria TypeScript per Ethereum (usata da Wagmi internamente)
import { formatEther } from 'viem';
// formatEther: Converte wei in ETH (es: 1000000000000000000n → "1.0")

// Costanti del progetto: ABI e indirizzo del contratto ZKBoard
import { ZKBOARD_ABI, ZKBOARD_ADDRESS } from '../utils/constants';

// ============================================================================
// INTERFACCIA TYPESCRIPT
// ============================================================================

// Struttura dati per una richiesta di relay
// Questa interfaccia descrive come memorizziamo le richieste nella UI
interface RelayRequest {
  id: number;           // ID della richiesta (indice nell'array relayRequests del contratto)
  message: string;      // Il messaggio da postare (già incluso nella richiesta)
  relayFee: bigint;     // La fee offerta al relayer (in wei, es: 1000000000000000n = 0.001 ETH)
  requester: string;    // Indirizzo Ethereum di chi ha creato la richiesta
  executed: boolean;    // true = già eseguita, false = ancora pending
}

// ============================================================================
// COMPONENTE PRINCIPALE: RelayPage
// ============================================================================

export default function RelayPage() {  // Qui inizia la logica a runtime

  // --------------------------------------------------------------------------
  // STATO LOCALE (useState)
  // --------------------------------------------------------------------------

  // Hook Wagmi per ottenere l'account connesso
  const { address, isConnected } = useAccount();  // destructuring assignment --> useAccount() restituisce un oggetto che prende la proprietà di address e la mette in address e fa lo stesso per isConnected
  // address: l'indirizzo Ethereum connesso (es: "0x1234...")
  // isConnected: true se il wallet è connesso, false altrimenti

  // Array delle richieste di relay caricate dalla blockchain
  const [requests, setRequests] = useState<RelayRequest[]>([]);  // In questo caso sto dicendo che useState ritorna una coppia di <requests, setRequests> e che requests è un array di RelayRequest inizialmente vuoto
  // Questo array contiene SOLO le richieste pending (executed=false)
  // Viene popolato dalla funzione loadRequests() che chiama l'API

  // Contatore di quante richieste abbiamo relayed in questa sessione
  const [relayedCount, setRelayedCount] = useState(0);  // Inizializzo a 0 relayedCount
  // Viene incrementato quando una transazione di relay ha successo
  // Serve solo per la UI (statistiche), non è salvato da nessuna parte

  // --------------------------------------------------------------------------
  // LETTURA DEL CONTRATTO: nextRequestId
  // --------------------------------------------------------------------------

  // Hook Wagmi per leggere il valore di nextRequestId dal contratto
  const { data: nextRequestId, refetch: refetchNextId } = useReadContract({  // Prendi la proprietà data e salvala in una variabile chiamata nextRequestId, prendi la proprietà refetch e salvala in una variabile chiamata refetchNextId. Stessa cosa per refetchNextId. useReadContract() restituisce un oggetto con più proprietà
    address: ZKBOARD_ADDRESS,           // Indirizzo del contratto ZKBoard
    abi: ZKBOARD_ABI,                   // ABI del contratto (per sapere come chiamare le funzioni)
    functionName: 'nextRequestId',      // Nome della funzione da chiamare (view function)
    query: {
      refetchInterval: 5000,            // Auto-refresh ogni 5 secondi (5000ms)
    },
  });
  // nextRequestId: il numero totale di richieste create (l'ID della prossima richiesta)
  //                Es: se nextRequestId=10, esistono le richieste con ID da 0 a 9
  // refetchNextId: funzione per forzare un re-fetch manuale (usata dopo un relay)

  // COME FUNZIONA useReadContract:
  // - Wagmi chiama automaticamente la funzione nextRequestId() del contratto
  // - Il risultato viene salvato in nextRequestId (tipo: bigint | undefined)
  // - Se query.refetchInterval è impostato, richiama ogni N millisecondi
  // - Quando il valore cambia, React re-renderizza il componente

  // --------------------------------------------------------------------------
  // SCRITTURA SUL CONTRATTO: executeRelay
  // --------------------------------------------------------------------------

  // Hook Wagmi per scrivere sul contratto (chiamare executeRelay)
  const { data: relayHash, writeContract, isPending } = useWriteContract();  // Faccio un deconstructing di un oggetto e mi restituisce un oggetto dal quale estraggo 3 proprietà : writeContract e isPending li estraggo con lo stesso nome, data lo rinomino in relayHash
  // relayHash: hash della transazione dopo che è stata inviata (tipo: `0x${string}` | undefined)
  // writeContract: funzione per inviare una transazione
  // isPending: true mentre la transazione è in pending (tra invio e conferma)

  // COME FUNZIONA useWriteContract:
  // 1. Chiamiamo writeContract({ address, abi, functionName, args })
  // 2. Si apre MetaMask (o altro wallet) per firmare la transazione
  // 3. Dopo la firma, la transazione viene inviata alla blockchain
  // 4. relayHash viene popolato con l'hash della transazione
  // 5. isPending = true fino alla conferma

  // --------------------------------------------------------------------------
  // ATTESA CONFERMA TRANSAZIONE
  // --------------------------------------------------------------------------

  // Hook Wagmi per attendere che la transazione di relay venga confermata
  const { isSuccess } = useWaitForTransactionReceipt({  // Prendo la proprietà isSuccess dall'oggetto restituito da useWaitForTransactionReceipt()
    hash: relayHash,    // Hash della transazione da attendere
    onSuccess() {
      // Callback eseguita quando la transazione è confermata (inclusa in un blocco)
      setRelayedCount(prev => prev + 1);  // Incrementa il contatore di sessione
      loadRequests();                      // Ricarica le richieste (quella relayed non apparirà più)
      refetchNextId();                     // Aggiorna nextRequestId (potrebbero esserne arrivate di nuove)
    },
  });
  // isSuccess: true quando la transazione è confermata, false altrimenti

  // FLOW COMPLETO DI UN RELAY:
  // 1. User clicca "Relay" → handleRelay() viene chiamata
  // 2. handleRelay() chiama writeContract() → si apre MetaMask
  // 3. User firma → transazione inviata → relayHash popolato
  // 4. isPending = true → bottone disabilitato
  // 5. Transazione confermata → onSuccess() eseguita
  // 6. onSuccess() aggiorna la UI (rimuove la richiesta dall'array)

  // --------------------------------------------------------------------------
  // WATCH EVENTI: RelayRequestCreated
  // --------------------------------------------------------------------------

  // Hook Wagmi per ascoltare l'evento RelayRequestCreated in tempo reale
  useWatchContractEvent({
    address: ZKBOARD_ADDRESS,           // Indirizzo del contratto da monitorare
    abi: ZKBOARD_ABI,                   // ABI del contratto (per decodificare gli eventi)
    eventName: 'RelayRequestCreated',   // Nome dell'evento da ascoltare
    onLogs() {
      // Callback eseguita quando l'evento viene emesso
      loadRequests();   // Ricarica le richieste (ce n'è una nuova!)
      refetchNextId();  // Aggiorna nextRequestId (è incrementato)
    },
  });
  // QUANDO VIENE TRIGGERATO:
  // - Ogni volta che qualcuno chiama createRelayRequest() sul contratto
  // - L'evento RelayRequestCreated viene emesso
  // - Wagmi lo riceve via WebSocket (se disponibile) o polling
  // - onLogs() viene eseguita → la UI si aggiorna automaticamente

  // --------------------------------------------------------------------------
  // FUNZIONE: loadRequests
  // --------------------------------------------------------------------------

  // Funzione che carica tutte le richieste di relay dal contratto
  // Viene chiamata:
  // - Al mount del componente (useEffect)
  // - Dopo un relay completato (onSuccess)
  // - Quando viene creata una nuova richiesta (onLogs)
  const loadRequests = async () => {
    // Se nextRequestId non è ancora stato caricato, non fare nulla
    if (!nextRequestId) return;

    // Converte nextRequestId da bigint a number
    // Es: 10n → 10
    const totalRequests = Number(nextRequestId);

    // Array temporaneo per raccogliere le richieste pending
    const loadedRequests: RelayRequest[] = [];

    // OTTIMIZZAZIONE: Carichiamo solo le ultime 50 richieste
    // Motivo: Se ci sono 1000 richieste, caricare tutte sarebbe lento
    // Le richieste più vecchie sono probabilmente già eseguite
    const start = Math.max(0, totalRequests - 50);
    // Es: se totalRequests=100, start=50 (carichiamo da 50 a 99)
    //     se totalRequests=20,  start=0  (carichiamo tutte)

    // Loop su tutte le richieste da caricare
    for (let i = start; i < totalRequests; i++) {
      try {
        // Chiamata all'API route per ottenere i dati della richiesta
        // L'API chiama relayRequests(i) sul contratto e restituisce i dati
        const response = await fetch(`/api/relay-request?id=${i}`, { cache: 'no-store' });
        const data = await response.json();

        // FILTRAGGIO: Aggiungiamo SOLO se:
        // 1. I dati sono validi (data esiste)
        // 2. La richiesta NON è stata ancora eseguita (!data.executed)
        // 3. Il messaggio non è vuoto (data.message esiste)
        if (data && !data.executed && data.message) {
          loadedRequests.push({
            id: i,
            message: data.message,
            relayFee: BigInt(data.relayFee),  // Converte la stringa in bigint
            requester: data.requester,
            executed: data.executed,
          });
        }
        // Se executed=true, la richiesta viene IGNORATA (non appare nella lista)

      } catch (e) {
        // Se una singola richiesta fallisce, continuiamo con le altre
        // Questo può succedere se l'API è temporaneamente down o se c'è un errore di rete
        // Non mostriamo errori all'utente, semplicemente quella richiesta non appare
      }
    }

    // ORDINAMENTO: Mettiamo le richieste con fee più alta in cima
    // Motivo: I relayer vogliono vedere prima le richieste più profittevoli
    loadedRequests.sort((a, b) => Number(b.relayFee - a.relayFee));
    // Es: se a.relayFee=1000000000000000 (0.001 ETH) e b.relayFee=2000000000000000 (0.002 ETH)
    //     allora b viene prima di a (fee più alta = priorità maggiore)

    // Aggiorna lo stato con le richieste caricate
    setRequests(loadedRequests);
  };

  // --------------------------------------------------------------------------
  // EFFECT: Auto-carica richieste quando cambia nextRequestId
  // --------------------------------------------------------------------------

  // useEffect che si attiva ogni volta che nextRequestId cambia
  useEffect(() => {
    loadRequests();
  }, [nextRequestId]);
  // Quando viene montato il componente, nextRequestId viene caricato
  // Questo effect viene triggerato → loadRequests() viene chiamata
  // Successivamente, se arriva una nuova richiesta, nextRequestId cambia → reload

  // --------------------------------------------------------------------------
  // FUNZIONE: handleRelay
  // --------------------------------------------------------------------------

  // Funzione chiamata quando l'utente clicca il bottone "Relay"
  // Parametro: requestId = ID della richiesta da eseguire
  const handleRelay = (requestId: number) => {
    // Chiama il contratto ZKBoard per eseguire il relay
    writeContract({
      address: ZKBOARD_ADDRESS,         // Indirizzo del contratto ZKBoard
      abi: ZKBOARD_ABI,                 // ABI del contratto
      functionName: 'executeRelay',     // Funzione da chiamare
      args: [BigInt(requestId)],        // Argomenti: solo il requestId convertito in bigint
    });
    // COSA SUCCEDE NEL CONTRATTO:
    // 1. Legge relayRequests[requestId] per ottenere merkleTreeRoot, nullifierHash, proof, message
    // 2. Chiama semaphore.verifyProof() per verificare la proof ZK (COSTOSO: ~350k gas!)
    // 3. Se la proof è valida, emette MessagePosted con il messaggio
    // 4. Trasferisce la relayFee al msg.sender (il relayer, cioè noi)
    // 5. Marca relayRequests[requestId].executed = true
    // 6. Emette l'evento MessageRelayed

    // COSTO:
    // Gas: ~400k gas = ~0.0015 ETH (a 15 gwei)
    // Guadagno: relayFee (tipicamente 0.001 ETH in questo progetto)
    // Profitto: -0.0005 ETH (perdita!)

    // NOTA: In produzione, la relayFee dovrebbe essere >= 0.002 ETH per essere profittevole
  };

  // --------------------------------------------------------------------------
  // RENDER (JSX)
  // --------------------------------------------------------------------------

  return (
    // Container principale: fullscreen con gradiente scuro
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white relative overflow-hidden">

      {/* ===================================================================== */}
      {/* SFONDO ANIMATO                                                        */}
      {/* ===================================================================== */}

      {/* Sfondo con cerchi colorati sfocati che pulsano (effetto estetico) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Cerchio verde in alto al centro */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[700px] bg-emerald-500/10 rounded-full blur-3xl animate-pulse"></div>
        {/* Cerchio ciano in basso a destra (animazione ritardata di 1.5s) */}
        <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-cyan-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1.5s' }}></div>
      </div>

      {/* ===================================================================== */}
      {/* HEADER                                                                */}
      {/* ===================================================================== */}

      {/* Barra superiore con logo, titolo e bottone wallet */}
      <header className="relative z-10 border-b border-slate-700/50 backdrop-blur-xl bg-slate-900/80">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">

          {/* Logo e titolo a sinistra */}
          <div className="flex items-center gap-3">
            {/* Icona 🔄 (simbolo di relay/ciclo) */}
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-cyan-600 rounded-lg flex items-center justify-center shadow-lg">
              <span className="text-xl font-black">🔄</span>
            </div>
            {/* Titolo e sottotitolo */}
            <div>
              <div className="text-xl font-black tracking-tight">Relay Dashboard</div>
              <div className="text-xs text-slate-400">Earn fees by relaying messages</div>
            </div>
          </div>

          {/* Link e wallet a destra */}
          <div className="flex items-center gap-4">
            {/* Link per tornare alla board principale */}
            <a
              href="/board"
              className="text-sm font-semibold text-slate-400 hover:text-indigo-400 transition-colors"
            >
              Back to Board
            </a>
            {/* Bottone RainbowKit per connettere/disconnettere il wallet */}
            <ConnectButton showBalance={false} chainStatus="icon" />
            {/* showBalance={false}: non mostra il saldo ETH */}
            {/* chainStatus="icon": mostra solo l'icona della chain (Sepolia) */}
          </div>
        </div>
      </header>

      {/* ===================================================================== */}
      {/* CONTENUTO PRINCIPALE                                                  */}
      {/* ===================================================================== */}

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-8">

        {/* Se il wallet NON è connesso, mostra messaggio di richiesta connessione */}
        {!isConnected ? (
          <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-12 text-center shadow-xl">
            {/* Icona grande */}
            <div className="text-6xl mb-6">🔗</div>
            {/* Titolo */}
            <h2 className="text-3xl font-bold text-white mb-3">Connect Your Wallet</h2>
            {/* Descrizione */}
            <p className="text-slate-400 mb-8 max-w-md mx-auto">
              Connect your wallet to start relaying messages and earning fees
            </p>
            {/* Bottone per connettere */}
            <ConnectButton />
          </div>
        ) : (
          // Se il wallet È connesso, mostra la dashboard completa
          <div className="space-y-6">

            {/* ================================================================= */}
            {/* CARD STATISTICHE                                                  */}
            {/* ================================================================= */}

            {/* Griglia con 3 card: Pending Requests, Relayed (Session), Status */}
            <div className="grid md:grid-cols-3 gap-6">

              {/* CARD 1: Pending Requests */}
              <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-xl">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-slate-400">Pending Requests</div>
                  <span className="text-2xl">📬</span>
                </div>
                {/* Numero di richieste nell'array (solo pending, filtrate da loadRequests) */}
                <div className="text-4xl font-black text-white">{requests.length}</div>
                <div className="text-xs text-slate-500 mt-2">Available to relay</div>
              </div>

              {/* CARD 2: Relayed (Session) */}
              <div className="bg-gradient-to-br from-emerald-500/10 to-cyan-500/10 backdrop-blur-xl border border-emerald-500/30 rounded-2xl p-6 shadow-xl">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-emerald-400">Relayed (Session)</div>
                  <span className="text-2xl">✅</span>
                </div>
                {/* Contatore di quante richieste abbiamo relayed in questa sessione */}
                <div className="text-4xl font-black text-white">{relayedCount}</div>
                <div className="text-xs text-slate-500 mt-2">Messages processed</div>
              </div>

              {/* CARD 3: Status */}
              <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-xl">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-slate-400">Status</div>
                  {/* Icona dinamica: clessidra se in pending, pallino verde altrimenti */}
                  <span className="text-2xl">
                    {isPending ? '⏳' : '🟢'}
                  </span>
                </div>
                {/* Testo dinamico basato sullo stato */}
                <div className="text-2xl font-black text-white">
                  {isPending ? 'Processing' : 'Ready'}
                </div>
                <div className="text-xs text-slate-500 mt-2">
                  {isPending ? 'Relaying message...' : 'Waiting for requests'}
                </div>
              </div>
            </div>

            {/* ================================================================= */}
            {/* LISTA RICHIESTE                                                   */}
            {/* ================================================================= */}

            {/* Card contenente la lista delle richieste pending */}
            <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-xl">

              {/* Header della lista */}
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-white">Available Requests</h2>
                <div className="text-sm text-slate-400">
                  Sorted by fee (highest first)
                  {/* Le richieste sono ordinate per fee decrescente (loadRequests.sort) */}
                </div>
              </div>

              {/* Se NON ci sono richieste, mostra messaggio vuoto */}
              {requests.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-6xl mb-4">📭</div>
                  <h3 className="text-xl font-bold text-white mb-2">No Pending Requests</h3>
                  <p className="text-slate-400">Check back soon or wait for new relay requests to appear</p>
                </div>
              ) : (
                // Se CI sono richieste, mostra la lista scrollabile
                <div className="space-y-3 max-h-[600px] overflow-y-auto custom-scrollbar">
                  {/* Map su tutte le richieste */}
                  {requests.map((req, idx) => (
                    // Card singola richiesta
                    <div
                      key={req.id}
                      className="bg-slate-900/50 border border-slate-700/30 rounded-xl p-5 hover:border-emerald-500/50 transition-all duration-200 animate-fade-in"
                      style={{ animationDelay: `${idx * 30}ms` }}
                      // Animazione fade-in con delay crescente (effetto cascata)
                      // idx=0 → 0ms, idx=1 → 30ms, idx=2 → 60ms, etc.
                    >
                      <div className="flex items-start justify-between gap-4">

                        {/* Contenuto a sinistra (messaggio e info) */}
                        <div className="flex-1 min-w-0">

                          {/* Badge con ID e indirizzo richiedente */}
                          <div className="flex items-center gap-3 mb-3">
                            {/* Badge ID richiesta */}
                            <span className="text-xs font-bold text-indigo-400 bg-indigo-500/10 px-3 py-1 rounded-full">
                              #{req.id}
                            </span>
                            {/* Indirizzo abbreviato (primi 6 + ultimi 4 caratteri) */}
                            <span className="text-xs text-slate-500">
                              from {req.requester.slice(0, 6)}...{req.requester.slice(-4)}
                            </span>
                          </div>

                          {/* Testo del messaggio (massimo 2 righe) */}
                          <div className="text-sm text-slate-300 mb-3 line-clamp-2 break-words">
                            {req.message}
                            {/* line-clamp-2: Tailwind utility che tronca dopo 2 righe */}
                            {/* break-words: permette di spezzare parole lunghe */}
                          </div>

                          {/* Relay fee (grande e in evidenza) */}
                          <div className="flex items-center gap-2">
                            <span className="text-2xl font-black text-emerald-400">
                              {formatEther(req.relayFee)}
                              {/* formatEther converte wei in ETH */}
                              {/* Es: 1000000000000000n → "0.001" */}
                            </span>
                            <span className="text-sm text-slate-400">ETH</span>
                          </div>
                        </div>

                        {/* Bottone "Relay" a destra */}
                        <button
                          onClick={() => handleRelay(req.id)}
                          disabled={isPending}
                          // Disabilitato se c'è già un relay in pending (evitiamo doppi click)
                          className="bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 disabled:from-slate-700 disabled:to-slate-700 text-white font-bold py-3 px-6 rounded-xl transition-all duration-200 hover:scale-105 disabled:hover:scale-100 disabled:opacity-50 shadow-lg flex-shrink-0"
                        >
                          {isPending ? 'Processing...' : 'Relay'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ================================================================= */}
            {/* LINK TRANSAZIONE                                                  */}
            {/* ================================================================= */}

            {/* Se c'è un hash di transazione, mostra link a Etherscan */}
            {relayHash && (
              <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-4 text-center animate-fade-in">
                <a
                  href={`https://sepolia.etherscan.io/tx/${relayHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  // target="_blank": apre in nuova tab
                  // rel="noopener noreferrer": sicurezza (previene accesso a window.opener)
                  className="text-indigo-400 hover:text-indigo-300 font-semibold transition-colors"
                >
                  View transaction on Etherscan →
                </a>
              </div>
            )}

            {/* ================================================================= */}
            {/* INFO BOX                                                          */}
            {/* ================================================================= */}

            {/* Card informativa su come funziona il relaying */}
            <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-xl">
              <h3 className="text-lg font-bold text-white mb-4">How Relaying Works</h3>
              <div className="space-y-3 text-sm text-slate-300">

                {/* Info 1: Guadagno fee */}
                <div className="flex items-start gap-3">
                  <span className="text-lg flex-shrink-0">💰</span>
                  <div>
                    <div className="font-semibold text-white">Earn Fees</div>
                    <div className="text-xs text-slate-400 mt-1">
                      You earn the relay fee for each message you process
                    </div>
                  </div>
                </div>

                {/* Info 2: Sistema trustless */}
                <div className="flex items-start gap-3">
                  <span className="text-lg flex-shrink-0">🔒</span>
                  <div>
                    <div className="font-semibold text-white">Trustless System</div>
                    <div className="text-xs text-slate-400 mt-1">
                      You can't modify messages - everything is cryptographically verified
                      {/* La proof ZK garantisce che il messaggio sia autentico */}
                      {/* Il relayer può solo eseguire, non può modificare nulla */}
                    </div>
                  </div>
                </div>

                {/* Info 3: Costi gas */}
                <div className="flex items-start gap-3">
                  <span className="text-lg flex-shrink-0">⚡</span>
                  <div>
                    <div className="font-semibold text-white">Gas Costs</div>
                    <div className="text-xs text-slate-400 mt-1">
                      You pay gas to relay, but earn more from the fee (typically ~0.0007 ETH profit)
                      {/* NOTA: In questo progetto educativo il profitto è negativo! */}
                      {/* Gas: ~0.0015 ETH, Fee: ~0.001 ETH → Perdita: -0.0005 ETH */}
                      {/* In produzione la fee dovrebbe essere >= 0.002 ETH */}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ===================================================================== */}
      {/* STILI PERSONALIZZATI                                                  */}
      {/* ===================================================================== */}

      {/* Custom scrollbar e animazioni */}
      <style jsx global>{`
        /* Scrollbar personalizzata per la lista richieste */
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;  /* Larghezza barra di scorrimento */}
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(51, 65, 85, 0.3);  /* Track scuro semi-trasparente */
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(16, 185, 129, 0.5);  /* Thumb verde (emerald-500) */
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(16, 185, 129, 0.7);  /* Più opaco on hover */
        }

        /* Animazione fade-in per le card richieste */
        @keyframes fade-in {
          from {
            opacity: 0;              /* Parte invisibile */
            transform: translateY(10px);  /* 10px più in basso */
          }
          to {
            opacity: 1;              /* Diventa completamente visibile */
            transform: translateY(0);     /* Torna alla posizione normale */
          }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out forwards;
          /* 0.3s: durata animazione */
          /* ease-out: rallenta verso la fine */
          /* forwards: mantiene lo stato finale */
        }
      `}</style>
    </div>
  );
}

/*
╔═══════════════════════════════════════════════════════════════════════════════╗
║                          📚 SUMMARY EDUCATIVO                                  ║
╚═══════════════════════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. SCOPO DELLA PAGINA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Questa pagina implementa la DASHBOARD DEI RELAYER, la seconda faccia del sistema
di relay network.

PROBLEMA RISOLTO:
Molti utenti hanno identità Semaphore (possono generare proof ZK) ma NON hanno
ETH per pagare il gas delle transazioni. Come possono postare messaggi?

SOLUZIONE:
Sistema di relay in 2 fasi:

FASE 1 - Creazione Richiesta (utente senza ETH):
  → Genera proof ZK client-side (gratis)
  → Chiama createRelayRequest() con proof + message + fee offerta
  → Gas basso: ~50k (~0.0002 ETH) - sostenibile anche con pochi fondi
  → Richiesta salvata on-chain con executed=false

FASE 2 - Esecuzione Richiesta (relayer con ETH):
  → Questa pagina mostra tutte le richieste pending
  → Il relayer sceglie quale eseguire (ordinate per fee)
  → Chiama executeRelay(requestId) pagando il gas
  → Gas alto: ~400k (~0.0015 ETH) - per verificare la proof ZK
  → Guadagna la relay fee come compenso
  → Richiesta marcata come executed=true

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. FLOW COMPLETO UTENTE RELAYER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 1: ARRIVO SULLA PAGINA
  → L'utente naviga su /relay
  → Se il wallet non è connesso → messaggio "Connect Your Wallet"
  → Clicca il ConnectButton di RainbowKit
  → Sceglie MetaMask/WalletConnect/etc.

STEP 2: CARICAMENTO DASHBOARD
  → useReadContract carica nextRequestId dal contratto
  → nextRequestId cambia → useEffect triggera loadRequests()
  → loadRequests() chiama /api/relay-request per ogni richiesta
  → Filtra solo quelle con executed=false
  → Le ordina per relayFee decrescente (più profittevoli prima)
  → setRequests() aggiorna la UI

STEP 3: VISUALIZZAZIONE RICHIESTE
  → La pagina mostra 3 card statistiche:
    - Pending Requests: quante richieste disponibili
    - Relayed (Session): quante ne ho eseguite io
    - Status: Ready/Processing
  → Lista scrollabile con tutte le richieste pending
  → Ogni richiesta mostra:
    - ID e indirizzo richiedente
    - Testo del messaggio
    - Relay fee offerta (in ETH, grande e in evidenza)
    - Bottone "Relay"

STEP 4: ESECUZIONE RELAY
  → L'utente clicca "Relay" sulla richiesta che preferisce
  → handleRelay(requestId) viene chiamata
  → writeContract() invia la transazione executeRelay(requestId)
  → Si apre MetaMask per firmare
  → Gas stimato: ~400k gas = ~0.0015 ETH (a 15 gwei)

STEP 5: ATTESA CONFERMA
  → isPending = true → bottone disabilitato
  → relayHash popolato → appare link a Etherscan
  → useWaitForTransactionReceipt attende la conferma
  → Blockchain mina il blocco (12-15 secondi su Sepolia)

STEP 6: CONFERMA E AGGIORNAMENTO
  → Transazione confermata → onSuccess() eseguita:
    1. setRelayedCount(prev => prev + 1) - incrementa contatore
    2. loadRequests() - ricarica lista (rimuove la richiesta eseguita)
    3. refetchNextId() - controlla se ne sono arrivate di nuove
  → La richiesta scompare dalla lista (ora executed=true)
  → Il relayer ha guadagnato la fee (trasferita dal contratto)

STEP 7: MONITORAGGIO REAL-TIME
  → useWatchContractEvent ascolta RelayRequestCreated
  → Se qualcuno crea una nuova richiesta → evento emesso
  → onLogs() triggera loadRequests() → nuova richiesta appare
  → Dashboard sempre aggiornata senza bisogno di refresh!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. COMPONENTI CHIAVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

A) HOOK WAGMI UTILIZZATI:

1. useAccount()
   → Restituisce address e isConnected
   → Usato per: mostrare UI condizionale (connesso/non connesso)

2. useReadContract()
   → Legge nextRequestId dal contratto
   → Configurato con refetchInterval: 5000 (auto-refresh ogni 5s)
   → Quando cambia → triggera loadRequests()

3. useWriteContract()
   → Invia transazione executeRelay(requestId)
   → Restituisce relayHash e isPending
   → isPending usato per disabilitare bottoni durante l'invio

4. useWaitForTransactionReceipt()
   → Attende conferma della transazione di relay
   → onSuccess: callback eseguita dopo conferma
   → Usato per: aggiornare UI e rimuovere richiesta dalla lista

5. useWatchContractEvent()
   → Ascolta evento RelayRequestCreated in tempo reale
   → Quando emesso → ricarica le richieste
   → Rende la dashboard "live" (no refresh manuale necessario)

B) FUNZIONI PRINCIPALI:

1. loadRequests()
   → Carica le ultime 50 richieste dal contratto
   → Per ogni ID chiama /api/relay-request?id=X
   → Filtra solo quelle con executed=false
   → Ordina per relayFee decrescente
   → Aggiorna lo stato requests

2. handleRelay(requestId)
   → Chiama executeRelay(requestId) sul contratto
   → Il contratto:
     a) Legge relayRequests[requestId]
     b) Verifica la proof ZK (costoso!)
     c) Emette MessagePosted
     d) Trasferisce la fee al relayer
     e) Marca executed=true

C) INTERFACCIA RelayRequest:

interface RelayRequest {
  id: number;           // Indice nell'array on-chain
  message: string;      // Testo del messaggio da postare
  relayFee: bigint;     // Fee in wei (es: 1000000000000000n = 0.001 ETH)
  requester: string;    // Indirizzo di chi ha creato la richiesta
  executed: boolean;    // true = già eseguita, false = pending
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. ECONOMIA DEL RELAY (INCENTIVI E COSTI)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COSTI PER IL RELAYER:

Gas per executeRelay():
  - Operazioni nel contratto:
    * Lettura di relayRequests mapping: ~2k gas
    * Chiamata a semaphore.verifyProof(): ~350k gas (la parte più costosa!)
    * Trasferimento ETH (fee al relayer): ~21k gas
    * Emissione evento MessagePosted: ~2k gas
    * Aggiornamento executed=true: ~5k gas
  - TOTALE: ~400k gas

  Su Sepolia (gas price tipico = 15 gwei):
  400,000 * 15 gwei = 6,000,000 gwei = 0.006 ETH

  Su Mainnet (gas price medio = 30 gwei):
  400,000 * 30 gwei = 12,000,000 gwei = 0.012 ETH

GUADAGNI PER IL RELAYER:

Relay fee tipica in questo progetto: 0.001 ETH

PROFITTO:
  Sepolia:  0.001 - 0.006 = -0.005 ETH (PERDITA!)
  Mainnet:  0.001 - 0.012 = -0.011 ETH (PERDITA MAGGIORE!)

PERCHÉ IL SISTEMA È IN PERDITA?

Questo è un PROGETTO EDUCATIVO, non pensato per produzione.
La fee è stata impostata bassa per facilitare i test.

IN PRODUZIONE, LA FEE DOVREBBE ESSERE:
  - Sepolia: >= 0.007 ETH (per coprire gas + margine)
  - Mainnet: >= 0.015 ETH (per coprire gas + margine)

OTTIMIZZAZIONE POSSIBILE:
  - Batch relay: eseguire più richieste in una sola transazione
  - Gas sponsor: il contratto potrebbe avere fondi per pagare il gas
  - L2 deployment: su Optimism/Arbitrum il gas è 100x più economico

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. SICUREZZA E TRUSTLESSNESS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DOMANDA CHIAVE: Perché dovrei fidarmi di un relayer?

RISPOSTA: NON DEVI FIDARTI! Il sistema è TRUSTLESS.

GARANZIE CRITTOGRAFICHE:

1. Il relayer NON può modificare il messaggio
   → Il messaggio è incluso nella proof ZK
   → Se il relayer cambia anche una lettera, la proof diventa invalida
   → semaphore.verifyProof() rifiuterebbe la transazione

2. Il relayer NON può postare a nome di qualcun altro
   → La proof ZK dimostra che chi ha creato la richiesta possiede
     una identità Semaphore valida nel gruppo
   → Il nullifierHash impedisce double-posting

3. Il relayer NON può rubare la fee
   → Il contratto trasferisce automaticamente la fee dopo la verifica
   → Se la proof è invalida → transazione revert → nessun trasferimento

4. Il relayer NON può rifiutare selettivamente richieste
   → Chiunque può essere un relayer
   → Se un relayer ignora richieste, altri le eseguiranno
   → Meccanismo di mercato: fee più alte vengono eseguite prima

UNICO RISCHIO:
  - Censura: se TUTTI i relayer ignorano una richiesta
  - Mitigazione: in un sistema reale ci sarebbero relayer automatizzati
                 (bot) che eseguono qualsiasi richiesta con fee > costo gas

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6. UI/UX DESIGN CHOICES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COLORI:
  - Emerald/Cyan: tema principale (richiama il profitto/guadagno)
  - Slate: background scuro professionale
  - Indigo: accenti per info/link

ANIMAZIONI:
  - Fade-in cascata: le richieste appaiono una dopo l'altra (effetto premium)
  - Pulse: sfondo pulsante (dinamismo)
  - Scale on hover: bottoni che crescono (feedback interattivo)

ORDINAMENTO:
  - Fee decrescente: i relayer vedono prima le richieste più profittevoli
  - Razionale: massimizza l'efficienza del mercato

LIMITE 50 RICHIESTE:
  - Performance: caricare 1000+ richieste sarebbe lento
  - Assumiamo: le richieste vecchie sono già state eseguite
  - Edge case: se ci sono 1000 richieste pending, ne vediamo solo le ultime 50
    (in produzione servirebbe paginazione)

REAL-TIME UPDATES:
  - useWatchContractEvent permette di vedere nuove richieste immediatamente
  - Non serve refresh manuale
  - Migliora l'esperienza per i relayer sempre connessi

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7. LIMITAZIONI E MIGLIORAMENTI FUTURI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LIMITAZIONI ATTUALI:

1. Fee sottocosto
   → In questo progetto la fee (0.001 ETH) è minore del costo gas (0.006 ETH)
   → Nessun relayer razionale userebbe questo sistema in produzione
   → FIX: aumentare DEFAULT_RELAY_FEE a 0.007+ ETH

2. No paginazione
   → Carica solo le ultime 50 richieste
   → Se ce ne sono 1000, il limite 50 potrebbe nascondere richieste valide
   → FIX: implementare paginazione con offset/limit

3. No filtri
   → Non si può filtrare per fee minima o messaggio
   → FIX: aggiungere input di filtro nella UI

4. No batch relay
   → Ogni relay è una transazione separata
   → Inefficiente se ci sono molte richieste
   → FIX: funzione executeMultipleRelays([id1, id2, ...])

5. No stima profitto
   → Non mostra "profitto stimato = fee - costo gas"
   → FIX: calcolare e mostrare il profitto atteso per ogni richiesta

POSSIBILI MIGLIORAMENTI:

1. Relayer Bot
   → Script automatico che monitora ed esegue richieste
   → Criteri: esegui se fee > (gas_price * 400k * 1.1)
   → Deployabile su server sempre online

2. Priorità dinamica
   → Permettere agli utenti di aumentare la fee dopo la creazione
   → Funzione updateRelayFee(requestId, newFee)

3. Scadenza richieste
   → Aggiungere timestamp + timeout (es: 24h)
   → Dopo timeout, l'utente può rimuovere la richiesta e riavere la fee

4. Reputation system
   → Tracciare quali relayer sono più veloci
   → Mostrare statistiche (avg tempo di esecuzione, richieste completate)

5. Gas optimization
   → Usare calldata invece di memory dove possibile
   → Packed structs per ridurre storage reads
   → Potenzialmente risparmiare 50k-100k gas

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
8. CONFRONTO CON ALTRI SISTEMI DI RELAY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ZKBOARD RELAY vs GSN (Gas Station Network):

GSN:
  - Protocollo generale per meta-transactions
  - Il relayer firma la transazione dell'utente
  - Richiede EIP-2771 (trusted forwarder)
  - Più complesso ma più flessibile

ZKBoard Relay:
  - Specifico per Semaphore proofs
  - Il relayer NON firma per l'utente (esegue solo)
  - Più semplice, meno overhead
  - Proof già generata → solo verifica on-chain

ZKBOARD RELAY vs Tornado Cash Relayer:

Tornado Cash:
  - Relayer per prelievi anonimi
  - Nasconde il link tra deposito e prelievo
  - Fee tipica: 0.5-1% del prelievo
  - Relayer centralizzati (lista)

ZKBoard Relay:
  - Relayer per messaggi anonimi
  - Nasconde l'identità del poster
  - Fee fissa (non percentuale)
  - Chiunque può essere relayer (permissionless)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
9. DOMANDE FREQUENTI (FAQ)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Q1: Cosa succede se nessun relayer esegue la mia richiesta?

A1: La richiesta rimane on-chain indefinitamente con executed=false.
    In un sistema reale ci sarebbero:
    - Bot automatici sempre in ascolto
    - Timeout dopo il quale l'utente può cancellare e riavere la fee

Q2: Posso eseguire la mia stessa richiesta?

A2: SÌ! Non c'è restrizione. Puoi:
    - Creare la richiesta con un account
    - Eseguirla con un altro account
    - La fee viene trasferita da te a te stesso
    - Unico costo: il gas (che paghi comunque)

Q3: Il relayer può vedere chi ha postato?

A3: NO! Il sistema è anonimo:
    - requester = indirizzo che ha chiamato createRelayRequest
    - Ma la proof ZK NON rivela QUALE identità Semaphore ha postato
    - Il requester potrebbe essere un proxy/burner wallet

Q4: Perché non usare direttamente postMessage()?

A4: postMessage() richiede che msg.sender abbia ETH per il gas (~0.0015 ETH).
    Con createRelayRequest():
    - Costo iniziale: ~0.0002 ETH (accessibile)
    - Qualcun altro paga il gas grosso
    - Tu paghi solo la fee (detratta dal tuo deposito)

Q5: Come viene garantita la fee al relayer?

A5: Nel contratto ZKBoard:
    - L'utente deposita ETH con topUpDeposit()
    - Quando chiama createRelayRequest(), la fee viene "riservata"
    - Quando il relayer esegue, il contratto trasferisce la fee
    - Se il deposito è insufficiente, createRelayRequest() reverte

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
10. ESEMPIO COMPLETO END-TO-END
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SCENARIO: Alice vuole postare ma non ha ETH. Bob fa il relayer.

PASSO 1: SETUP INIZIALE
  Alice:
    - Ha identità Semaphore (commitment = 123...456)
    - Ha depositato 0.01 ETH con joinGroupWithDeposit()
    - Ora ha credits = 10 (0.01 ETH / 0.001 = 10 messaggi)
    - Ma non ha ETH nel wallet per gas!

  Bob:
    - Ha 1 ETH nel wallet (può pagare gas)
    - Naviga su /relay per guadagnare fee

PASSO 2: ALICE CREA LA RICHIESTA
  - Alice va su /board
  - Scrive "Hello World"
  - Genera proof ZK (10 secondi)
  - Clicca "Post via Relay"
  - Chiama createRelayRequest(root, nullifier, proof, "Hello World", 0.001 ETH)
  - Gas pagato: 50k = 0.0002 ETH (ce la fa!)
  - Evento emesso: RelayRequestCreated(requestId=7, relayFee=0.001, timestamp=...)

PASSO 3: BOB VEDE LA RICHIESTA
  - useWatchContractEvent riceve l'evento
  - onLogs() triggera loadRequests()
  - Nuova card appare nella dashboard:
    * ID: #7
    * Messaggio: "Hello World"
    * Fee: 0.001 ETH
    * Bottone: "Relay"

PASSO 4: BOB ESEGUE IL RELAY
  - Bob clicca "Relay"
  - handleRelay(7) chiamata
  - writeContract() invia executeRelay(7)
  - MetaMask si apre, gas stimato: 400k = 0.0015 ETH
  - Bob conferma
  - isPending = true → bottone disabilitato

PASSO 5: CONTRATTO VERIFICA E ESEGUE
  - Contratto legge relayRequests[7]:
    * merkleTreeRoot: 789...012
    * nullifierHash: 345...678
    * proof: [...]
    * message: "Hello World"
    * relayFee: 0.001 ETH
  - Chiama semaphore.verifyProof(groupId, root, signal, nullifier, proof)
  - Proof VALIDA ✅
  - Emette MessagePosted("Hello World", timestamp, messageId)
  - Trasferisce 0.001 ETH a Bob
  - Marca executed = true

PASSO 6: AGGIORNAMENTO UI
  - useWaitForTransactionReceipt riceve conferma
  - onSuccess() eseguita:
    * setRelayedCount(1)
    * loadRequests() → richiesta #7 sparisce (executed=true)
    * refetchNextId()
  - Bob vede "Relayed (Session): 1"
  - Link Etherscan appare

PASSO 7: RISULTATO
  - Messaggio appare su /board per tutti
  - Alice: ha speso 0.001 ETH (fee) + 0.0002 ETH (gas creazione) = 0.0012 ETH
  - Bob: ha speso 0.0015 ETH (gas relay), guadagnato 0.001 ETH = -0.0005 ETH
  - Bob ha perso soldi, ma in produzione con fee = 0.002 ETH guadagnerebbe!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINE SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
*/
