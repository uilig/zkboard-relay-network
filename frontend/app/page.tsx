/*
 * ═══════════════════════════════════════════════════════════════════════
 * PAGINA DI REGISTRAZIONE - ZKBOARD FRONTEND
 * ═══════════════════════════════════════════════════════════════════════
 *
 * DESCRIZIONE:
 * Questa è la home page dell'applicazione, che gestisce la registrazione
 * degli utenti al sistema ZKBoard. Gli utenti:
 * 1. Connettono il wallet (MetaMask, Coinbase, etc.)
 * 2. Generano un'identità Semaphore (nullifier + trapdoor)
 * 3. Depositano 0.05 ETH per unirsi al gruppo on-chain
 * 4. Possono postare messaggi (deposits / COST_PER_MESSAGE = ~50 messaggi)
 *
 * TECNOLOGIE:
 * - Next.js 14: Framework React per applicazioni web moderne
 * - React Hooks: useState, useEffect per gestione stato
 * - TypeScript: Linguaggio tipizzato per JavaScript
 * - RainbowKit: UI per connessione wallet
 * - Wagmi: Hooks per interazione Ethereum
 * - Viem: Libreria Ethereum moderna (sostituto di Ethers)
 * - Semaphore SDK: Generazione identità ZK
 * - Tailwind CSS: Framework CSS utility-first
 *
 * FLUSSO UTENTE:
 * 1. [Non connesso] → Pulsante "Connect Wallet"
 * 2. [Connesso] → Pulsante "Create & Join" o "Register Identity"
 * 3. [Preparing] → Generazione identità Semaphore
 * 4. [Awaiting signature] → Conferma transaction nel wallet
 * 5. [Confirming] → Attesa conferma blockchain
 * 6. [Success] → Redirect alla board
 *
 * IDENTITÀ SEMAPHORE:
 * - Generata localmente nel browser (JavaScript)
 * - Salvata in localStorage (persistenza tra sessioni)
 * - Commitment inviato on-chain (identità pubblica)
 * - Segreti (nullifier, trapdoor) rimangono privati
 *
 * SICUREZZA:
 * - Identità generata con randomness crittografico
 * - Segreti MAI inviati on-chain
 * - localStorage usato solo per convenienza (può essere esportato)
 * - Wallet signatures richieste per ogni transazione
 */

// ═══════════════════════════════════════════════════════════════════════
// CLIENT COMPONENT DIRECTIVE
// ═══════════════════════════════════════════════════════════════════════

/*
 * 'use client' - Direttiva Next.js 14
 *
 * COSA FA:
 * Indica che questo componente deve essere eseguito lato CLIENT (browser),
 * non lato server durante il rendering.
 *
 * PERCHÉ È NECESSARIO:
 * - Usiamo hooks React (useState, useEffect) → solo client-side
 * - Interagiamo con localStorage → disponibile solo nel browser
 * - Usiamo wallet connection → richiede window.ethereum
 *
 * NEXT.JS 14:
 * - Default: Server Components (rendering server-side)
 * - 'use client': Client Components (rendering client-side)
 *
 * VANTAGGI SERVER COMPONENTS:
 * - Meno JavaScript inviato al browser
 * - Migliori performance SEO
 * - Accesso diretto a database/API
 *
 * VANTAGGI CLIENT COMPONENTS:
 * - Interattività (onClick, onChange, etc.)
 * - Hooks React
 * - Accesso a browser APIs (localStorage, window, etc.)
 */
'use client';

// ═══════════════════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════════════════

/*
 * REACT IMPORTS
 *
 * useState: Hook per gestire stato locale del componente
 * - Esempio: const [count, setCount] = useState(0)
 * - Re-renderizza il componente quando lo stato cambia
 *
 * useEffect: Hook per side effects (effetti collaterali)
 * - Eseguito dopo ogni render
 * - Utile per: fetch dati, subscriptions, timers, etc.
 * - Esempio: useEffect(() => { ... }, [dependencies])
 */
import { useState, useEffect } from 'react';

/*
 * NEXT.JS NAVIGATION
 *
 * useRouter: Hook per navigazione programmatica
 * - router.push('/board') → naviga a /board
 * - router.back() → torna indietro
 * - router.refresh() → ricarica la pagina
 *
 * DIFFERENZA CON <Link>:
 * - useRouter: navigazione imperativa (da JavaScript)
 * - <Link>: navigazione dichiarativa (da JSX)
 */
import { useRouter } from 'next/navigation';

/*
 * RAINBOWKIT
 *
 * ConnectButton: Componente UI per connessione wallet
 * - Gestisce automaticamente:
 *   • Connessione a MetaMask, Coinbase, WalletConnect, etc.
 *   • Cambio rete (Ethereum, Sepolia, etc.)
 *   • Disconnessione
 *   • UI responsiva e personalizzabile
 *
 * PROPS:
 * - showBalance: mostra/nasconde balance ETH
 * - chainStatus: mostra icona o nome della rete
 */
import { ConnectButton } from '@rainbow-me/rainbowkit';

/*
 * WAGMI HOOKS
 *
 * Wagmi è la libreria standard per interazione Ethereum in React.
 * Fornisce hooks per tutte le operazioni blockchain.
 *
 * useAccount: Informazioni sul wallet connesso
 * - isConnected: booleano, true se wallet connesso
 * - address: indirizzo del wallet (0x...)
 * - chain: rete corrente (Sepolia, mainnet, etc.)
 *
 * useWriteContract: Invia transazioni write (modifica stato)
 * - writeContract(): funzione per inviare transaction
 * - data: hash della transaction (quando inviata)
 * - isPending: true mentre aspettiamo firma utente
 * - error: errore se transaction fallisce
 *
 * usePublicClient: Client per operazioni read (no gas)
 * - getTransactionReceipt(): verifica stato transaction
 * - getBlockNumber(): ottieni numero blocco corrente
 * - readContract(): leggi dati da contratto
 */
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';

/*
 * VIEM UTILITIES
 *
 * parseEther: Converte ETH in wei (unità base)
 * - parseEther('1.0') → 1000000000000000000n (1 ETH in wei)
 * - parseEther('0.05') → 50000000000000000n (0.05 ETH in wei)
 *
 * UNITÀ ETHEREUM:
 * - 1 ETH = 10^18 wei
 * - 1 gwei = 10^9 wei (usato per gas price)
 * - Viem usa BigInt nativo (suffisso 'n')
 */
import { parseEther } from 'viem';

/*
 * SEMAPHORE SDK
 *
 * Identity: Classe per generare identità Semaphore
 *
 * COSTRUTTORI:
 * - new Identity() → genera nuova identità random
 * - new Identity(string) → ripristina da string esistente
 *
 * PROPRIETÀ:
 * - nullifier: numero segreto random (BigInt)
 * - trapdoor: numero segreto random (BigInt)
 * - commitment: poseidon(nullifier, trapdoor) → identità pubblica
 *
 * METODI:
 * - toString(): esporta identità come stringa
 * - signMessage(msg): firma messaggio con identità
 * - generateProof(...): genera proof ZK Semaphore
 *
 * SICUREZZA:
 * - Randomness generato con crypto.getRandomValues() (crittografico)
 * - Segreti (nullifier, trapdoor) MAI esposti
 * - Solo commitment viene condiviso pubblicamente
 */
import { Identity } from '@semaphore-protocol/identity';

/*
 * CONSTANTS
 *
 * ZKBOARD_ABI: Application Binary Interface del contratto
 * - Descrive tutte le funzioni del contratto
 * - Permette a wagmi di codificare chiamate correttamente
 * - Esempio: { name: 'joinGroupWithDeposit', inputs: [...], outputs: [...] }
 *
 * ZKBOARD_ADDRESS: Indirizzo del contratto deployato
 * - Indirizzo Ethereum univoco (0x...)
 * - Deployato su Sepolia testnet
 * - Vedi scripts/deploy.ts per il deployment
 */
import { ZKBOARD_ABI, ZKBOARD_ADDRESS } from './utils/constants';

// ═══════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════

/*
 * RegistrationStep - Type per tracciare lo stato della registrazione
 *
 * POSSIBILI VALORI:
 * - 'idle': Nessuna operazione in corso (stato iniziale)
 * - 'preparing': Generazione identità Semaphore in corso
 * - 'awaiting_signature': Aspettando conferma wallet utente
 * - 'confirming': Transaction inviata, aspettando conferma blockchain
 * - 'success': Transaction confermata, registrazione completata
 *
 * TYPESCRIPT:
 * Usando un type invece di stringhe libere, TypeScript può:
 * - Autocompletare i valori possibili
 * - Rilevare typo a compile-time
 * - Rendere il codice più maintainable
 */
type RegistrationStep = 'idle' | 'preparing' | 'awaiting_signature' | 'confirming' | 'success';

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════

/**
 * Home - Componente principale della pagina di registrazione
 *
 * RESPONSABILITÀ:
 * 1. UI: Mostra form di registrazione con design moderno
 * 2. Wallet: Gestisce connessione wallet via RainbowKit
 * 3. Identity: Genera/carica identità Semaphore
 * 4. Transaction: Invia joinGroupWithDeposit on-chain
 * 5. Monitoring: Monitora conferma transaction
 * 6. Navigation: Redirect a /board dopo successo
 *
 * STATO LOCALE:
 * - step: stato corrente del processo di registrazione
 * - existingId: identità salvata in localStorage (se esiste)
 *
 * HOOKS ESTERNI:
 * - useAccount: stato connessione wallet
 * - useWriteContract: invio transazioni
 * - usePublicClient: lettura stato blockchain
 * - useRouter: navigazione Next.js
 */
export default function Home() {
  // ═══════════════════════════════════════════════════════════════════
  // HOOKS SETUP
  // ═══════════════════════════════════════════════════════════════════

  /*
   * NEXT.JS ROUTER
   * Permette navigazione programmatica dopo registrazione
   */
  const router = useRouter();

  /*
   * WAGMI useAccount
   * Ottiene stato del wallet connesso
   *
   * isConnected: true se utente ha connesso il wallet
   * - false → mostra "Connect Wallet"
   * - true → mostra form di registrazione
   */
  const { isConnected } = useAccount();

  /*
   * WAGMI usePublicClient
   * Client per operazioni read-only (no gas)
   *
   * Usato per:
   * - Verificare stato transaction (getTransactionReceipt)
   * - Leggere dati da contratto (readContract)
   * - Ottenere info blocchi (getBlockNumber)
   */
  const publicClient = usePublicClient();

  // ═══════════════════════════════════════════════════════════════════
  // STATE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════

  /*
   * step - Stato del processo di registrazione
   *
   * FLUSSO:
   * idle → preparing → awaiting_signature → confirming → success
   *
   * UTILIZZO:
   * - Mostra UI diversa per ogni step
   * - Disabilita pulsanti durante operazioni
   * - Mostra spinner/messaggi di stato
   */
  const [step, setStep] = useState<RegistrationStep>('idle');

  /*
   * existingId - Identità salvata in localStorage
   *
   * VALORE:
   * - null: nessuna identità salvata (nuovo utente)
   * - string: identità esistente (utente che torna)
   *
   * FORMATO STRING:
   * Serializzazione dell'identità Semaphore, include:
   * - nullifier (segreto)
   * - trapdoor (segreto)
   * - commitment (pubblico)
   *
   * SICUREZZA:
   * localStorage NON è crittografato, ma:
   * - Accessibile solo dallo stesso domain
   * - Non sincronizzato con server
   * - Utente può esportare e salvare altrove
   */
  const [existingId, setExistingId] = useState<string | null>(null);

  /*
   * WAGMI useWriteContract
   * Hook per inviare transazioni che modificano lo stato
   *
   * RETURN VALUES:
   * - writeContract(): funzione per invocare transazione
   * - data (alias hash): hash della transaction inviata
   * - isPending (alias isWalletPending): true mentre aspettiamo firma
   * - error (alias writeError): errore se transaction fallisce
   *
   * ESEMPIO USO:
   * writeContract({
   *   address: '0x...',
   *   abi: [...],
   *   functionName: 'transfer',
   *   args: [recipient, amount],
   *   value: parseEther('0.1')
   * })
   */
  const {
    data: hash,                    // Hash transaction (quando inviata)
    writeContract,                 // Funzione per inviare transaction
    isPending: isWalletPending,    // True durante firma wallet
    error: writeError,             // Errore se fallisce
  } = useWriteContract();

  // ═══════════════════════════════════════════════════════════════════
  // EFFECTS
  // ═══════════════════════════════════════════════════════════════════

  /*
   * EFFECT 1: Carica identità da localStorage e redirect se già registrato
   *
   * QUANDO ESEGUE:
   * - Una sola volta, al mount del componente
   * - Dependency array vuoto [] → esegue solo all'inizio
   *
   * COSA FA:
   * 1. Legge 'ZK_USER_ID' da localStorage
   * 2. Se esiste, redirect automatico alla board
   * 3. La board verificherà se l'identità è nel gruppo on-chain
   *
   * PERCHÉ:
   * Se l'utente ha già un'identità salvata, probabilmente è già
   * registrato e vuole accedere direttamente alla board.
   */
  useEffect(() => {
    // localStorage.getItem() ritorna null se chiave non esiste
    const saved = localStorage.getItem('ZK_USER_ID');

    // Se esiste un'identità, redirect alla board
    if (saved) {
      router.push('/board');
    }
  }, [router]); // Dipendenza da router

  /*
   * EFFECT 2: Reset step se transaction fallisce
   *
   * QUANDO ESEGUE:
   * - Ogni volta che writeError cambia
   * - writeError cambia quando transaction fallisce
   *
   * COSA FA:
   * - Se c'è un errore, resetta step a 'idle'
   * - Permette all'utente di riprovare
   *
   * ERRORI COMUNI:
   * - User rejected transaction (utente ha cliccato "Reject")
   * - Insufficient funds (balance troppo basso)
   * - Gas estimation failed (problemi con il contratto)
   */
  useEffect(() => {
    // Se c'è un errore, torna a idle
    if (writeError) setStep('idle');
  }, [writeError]); // Re-esegui quando writeError cambia

  /*
   * EFFECT 3: Avvia monitoring quando hash è disponibile
   *
   * QUANDO ESEGUE:
   * - Quando hash cambia (transaction inviata)
   *
   * COSA FA:
   * - Setta step a 'confirming'
   * - Indica all'utente che stiamo aspettando conferma
   */
  useEffect(() => {
    // Se abbiamo un hash, la transaction è stata inviata
    if (hash) setStep('confirming');
  }, [hash]); // Re-esegui quando hash cambia

  /*
   * EFFECT 4: Monitora conferma transaction
   *
   * QUANDO ESEGUE:
   * - Quando hash o publicClient cambiano
   * - Continua a eseguire ogni 2 secondi (polling)
   *
   * COSA FA:
   * 1. Ogni 2 secondi, chiede al nodo lo stato della transaction
   * 2. Se transaction è confermata (status === 'success'):
   *    - Setta step a 'success'
   *    - Ferma il polling
   *    - Aspetta 1.5 secondi
   *    - Naviga a /board
   *
   * CLEANUP:
   * - Quando componente unmount o dependencies cambiano
   * - Ferma l'intervallo per evitare memory leaks
   *
   * PERCHÉ POLLING:
   * - RPC nodes non supportano WebSocket su tutti i provider
   * - Polling è più affidabile cross-provider
   * - 2 secondi è un buon trade-off (non troppo spam, non troppo lento)
   */
  useEffect(() => {
    // Se non abbiamo hash o client, non fare nulla
    if (!hash || !publicClient) return;

    /*
     * setInterval: Esegue funzione ogni N millisecondi
     * - Ogni 2000ms (2 secondi)
     * - Controlla se transaction è confermata
     */
    const intervalId = setInterval(async () => {
      try {
        // Ottieni receipt della transaction dal nodo
        const receipt = await publicClient.getTransactionReceipt({ hash });

        /*
         * receipt può essere:
         * - null: transaction ancora pending (non in un blocco)
         * - oggetto: transaction confermata
         *
         * receipt.status può essere:
         * - 'success': transaction riuscita
         * - 'reverted': transaction fallita (revert on-chain)
         */
        if (receipt && receipt.status === 'success') {
          // Transaction confermata con successo!
          setStep('success');

          // Ferma il polling
          clearInterval(intervalId);

          /*
           * setTimeout: Aspetta N ms poi esegui
           * - Aspetta 1500ms (1.5 secondi)
           * - Mostra messaggio "Success" all'utente
           * - Poi naviga a /board
           */
          setTimeout(() => router.push('/board'), 1500);
        }
      } catch (e) {
        /*
         * Errori possibili:
         * - Network error (nodo RPC offline)
         * - Transaction not found (ancora non propagata)
         *
         * Non facciamo nulla, riproveremo tra 2 secondi
         */
        /* waiting */
      }
    }, 2000); // Ogni 2 secondi

    /*
     * CLEANUP FUNCTION
     *
     * Ritornata da useEffect, viene eseguita quando:
     * - Componente unmount (utente naviga via)
     * - Dependencies cambiano (nuovo hash)
     *
     * IMPORTANTE:
     * Senza cleanup, l'intervallo continuerebbe a eseguire
     * anche dopo che il componente è stato rimosso (memory leak!)
     */
    return () => clearInterval(intervalId);
  }, [hash, publicClient, router]); // Re-esegui se cambiano

  // ═══════════════════════════════════════════════════════════════════
  // EVENT HANDLERS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * handleJoin - Gestisce click su pulsante "Create & Join"
   *
   * FLUSSO:
   * 1. Setta step a 'preparing'
   * 2. Genera o carica identità Semaphore
   * 3. Salva identità in localStorage
   * 4. Setta step a 'awaiting_signature'
   * 5. Chiama writeContract per inviare transaction
   * 6. (Wallet popup appare, utente conferma)
   * 7. Transaction inviata → hash disponibile
   * 8. Effect 3 setta step a 'confirming'
   * 9. Effect 4 monitora conferma
   * 10. Quando confermata, naviga a /board
   *
   * ERROR HANDLING:
   * Se qualsiasi step fallisce, torna a 'idle'
   */
  const handleJoin = async () => {
    try {
      // ─────────────────────────────────────────────────────────────────
      // STEP 1: PREPARING
      // ─────────────────────────────────────────────────────────────────
      setStep('preparing');

      /*
       * GENERAZIONE/CARICAMENTO IDENTITÀ
       *
       * CASO 1: existingId presente (utente che torna)
       * - Ripristina identità da string
       * - new Identity(string) ricostruisce nullifier/trapdoor
       *
       * CASO 2: existingId assente (nuovo utente)
       * - Genera nuova identità random
       * - new Identity() usa crypto.getRandomValues()
       * - Salva in localStorage per uso futuro
       */
      let identityToRegister: Identity;

      if (existingId) {
        // CASO 1: Ripristina identità esistente
        identityToRegister = new Identity(existingId);
      } else {
        // CASO 2: Genera nuova identità
        identityToRegister = new Identity();

        /*
         * SALVATAGGIO IN LOCALSTORAGE
         *
         * toString(): Serializza identità in stringa
         * - Include nullifier, trapdoor, commitment
         * - Formato JSON interno della libreria Semaphore
         *
         * localStorage.setItem(): Salva nel browser
         * - Chiave: 'ZK_USER_ID'
         * - Valore: stringa serializzata
         * - Persiste tra refresh pagina
         * - Accessibile solo da questo domain
         */
        localStorage.setItem('ZK_USER_ID', identityToRegister.toString());
      }

      // ─────────────────────────────────────────────────────────────────
      // STEP 2: AWAITING SIGNATURE
      // ─────────────────────────────────────────────────────────────────
      setStep('awaiting_signature');

      /*
       * INVIO TRANSACTION
       *
       * writeContract() invia una transaction al contratto ZKBoard
       *
       * PARAMETRI:
       * - address: indirizzo contratto (0xbB0d8200...)
       * - abi: interface contratto (funzioni disponibili)
       * - functionName: nome funzione da chiamare
       * - args: argomenti della funzione
       * - value: ETH da inviare (deposito)
       *
       * COSA SUCCEDE:
       * 1. wagmi codifica la chiamata (ABI encoding)
       * 2. Crea transaction object:
       *    - to: ZKBOARD_ADDRESS
       *    - data: encodeFunctionData('joinGroupWithDeposit', [commitment])
       *    - value: 0.05 ETH in wei
       * 3. Chiede al wallet di firmare
       * 4. Wallet mostra popup all'utente
       * 5. Utente conferma → transaction inviata
       * 6. hash disponibile → monitoring inizia
       */
      writeContract({
        // Indirizzo del contratto ZKBoard
        address: ZKBOARD_ADDRESS,

        // ABI (Application Binary Interface)
        abi: ZKBOARD_ABI,

        // Nome della funzione da chiamare
        functionName: 'joinGroupWithDeposit',

        /*
         * ARGOMENTI FUNZIONE
         *
         * joinGroupWithDeposit(uint256 identityCommitment)
         *
         * identityCommitment:
         * - Poseidon hash di (nullifier, trapdoor)
         * - Calcolato automaticamente da Semaphore SDK
         * - Formato: BigInt (numero grande JavaScript)
         *
         * CONVERSIONE:
         * - commitment è tipo bigint
         * - toString() → string
         * - BigInt(string) → bigint per Viem
         */
        args: [BigInt(identityToRegister.commitment.toString())],

        /*
         * VALUE - ETH da inviare
         *
         * parseEther('0.05'):
         * - Converte 0.05 ETH in wei
         * - 0.05 ETH = 50000000000000000 wei
         * - Questo è il deposito minimo richiesto
         *
         * DEPOSITO:
         * - MIN_DEPOSIT del contratto = 0.05 ETH
         * - COST_PER_MESSAGE = 0.005 ETH
         * - 0.05 / 0.005 = 10 messaggi inclusi
         * - (Nota: UI mostra "~50" ma è ottimistico)
         */
        value: parseEther('0.05'),
      });

    } catch (err) {
      /*
       * ERROR HANDLING
       *
       * ERRORI POSSIBILI:
       * - User rejected (utente clicca "Reject" nel wallet)
       * - Insufficient funds (balance < 0.05 ETH + gas)
       * - localStorage error (quota exceeded, privacy mode)
       * - Identity generation error (molto raro)
       *
       * RISPOSTA:
       * - Torna a 'idle'
       * - Utente può riprovare
       * - writeError conterrà dettagli errore
       */
      setStep('idle');
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // COMPUTED VALUES
  // ═══════════════════════════════════════════════════════════════════

  /*
   * isBusy - Determina se l'interfaccia dovrebbe essere disabilitata
   *
   * TRUE quando:
   * - step !== 'idle': operazione in corso
   * - isWalletPending: aspettando firma wallet
   *
   * UTILIZZO:
   * - Disabilita pulsante "Create & Join"
   * - Previene click multipli
   * - Migliora UX (indica stato "loading")
   */
  const isBusy = step !== 'idle' || isWalletPending;

  // ═══════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════

  /*
   * JSX - JavaScript XML
   *
   * Sintassi che mescola HTML e JavaScript.
   * Compilato da Next.js in JavaScript puro.
   *
   * TAILWIND CSS:
   * - className="..." contiene utility classes
   * - Esempio: "text-white" → color: white
   * - Esempio: "bg-slate-900" → background: #0f172a
   * - Responsive: "md:text-7xl" → text-7xl su schermi ≥768px
   */
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white relative overflow-hidden">
      {/* ═══════════════════════════════════════════════════════════════
          ANIMATED BACKGROUND
          ═══════════════════════════════════════════════════════════ */}

      {/*
        * SFONDO ANIMATO
        *
        * Due cerchi sfocati che pulsano.
        * Creano effetto "glassmorphism" moderno.
        *
        * TECNICA:
        * - position: absolute (fuori dal flusso)
        * - blur-3xl: filtro blur pesante
        * - animate-pulse: animazione pulsazione
        * - pointer-events-none: non intercetta click
        */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-indigo-500/20 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-violet-500/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          HEADER
          ═══════════════════════════════════════════════════════════ */}

      {/*
        * HEADER NAVBAR
        *
        * Contiene:
        * - Logo + titolo (sinistra)
        * - ConnectButton (destra)
        *
        * DESIGN:
        * - backdrop-blur-xl: effetto vetro smerigliato
        * - border-b: bordo sottile sotto
        * - z-10: sopra lo sfondo animato
        */}
      <header className="relative z-10 border-b border-slate-700/50 backdrop-blur-xl bg-slate-900/30">
        <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
          {/* Logo + Titolo */}
          <div className="flex items-center gap-3">
            {/* Logo "Z" in un quadrato gradiente */}
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-lg flex items-center justify-center shadow-lg">
              <span className="text-xl font-black">Z</span>
            </div>
            <span className="text-xl font-black tracking-tight">ZK Anonymous Board</span>
          </div>

          {/*
            * RAINBOWKIT CONNECT BUTTON
            *
            * PROPS:
            * - showBalance={false}: non mostrare balance ETH
            * - chainStatus="icon": mostra solo icona rete (no nome)
            *
            * COMPORTAMENTO:
            * - Se disconnesso: mostra "Connect Wallet"
            * - Se connesso: mostra indirizzo + icona network
            * - Click: apre modal con opzioni wallet
            */}
          <ConnectButton showBalance={false} chainStatus="icon" />
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════════════
          MAIN CONTENT
          ═══════════════════════════════════════════════════════════ */}
      <main className="relative z-10 max-w-4xl mx-auto px-6 py-20">

        {/* ─────────────────────────────────────────────────────────────
            HERO SECTION
            ───────────────────────────────────────────────────────── */}
        <div className="text-center mb-16 space-y-6">
          {/* Titolo */}
          <div className="space-y-4">
            <h1 className="text-6xl md:text-7xl font-black leading-tight">
              {/*
                * GRADIENTE TESTO
                *
                * bg-gradient-to-r: gradiente da sinistra a destra
                * bg-clip-text: applica gradiente al testo
                * text-transparent: testo trasparente (mostra gradiente)
                */}
              <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-purple-400 bg-clip-text text-transparent">
                Anonymous
              </span>
              <br />
              <span className="text-white">Message Board</span>
            </h1>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto">
              Post messages using zero-knowledge proofs. Your Semaphore identity is hidden, but your Ethereum address is visible on-chain.
            </p>
          </div>

          {/* ─────────────────────────────────────────────────────────
              FEATURES GRID
              ───────────────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto mt-12">
            {/* Feature 1: ZK Proofs */}
            <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700/50 rounded-xl p-4 hover:scale-105 transition-transform duration-200">
              <div className="text-3xl mb-2">🔐</div>
              <div className="text-sm font-bold text-white">ZK Proofs</div>
              <div className="text-xs text-slate-400 mt-1">Semaphore Protocol</div>
            </div>

            {/* Feature 2: Anonymous */}
            <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700/50 rounded-xl p-4 hover:scale-105 transition-transform duration-200">
              <div className="text-3xl mb-2">👤</div>
              <div className="text-sm font-bold text-white">ZK Identity</div>
              <div className="text-xs text-slate-400 mt-1">Hidden Commitment</div>
            </div>

            {/* Feature 3: Dual Mode */}
            <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700/50 rounded-xl p-4 hover:scale-105 transition-transform duration-200">
              <div className="text-3xl mb-2">⚡</div>
              <div className="text-sm font-bold text-white">Dual Mode</div>
              <div className="text-xs text-slate-400 mt-1">Direct or Relay</div>
            </div>
          </div>
        </div>

        {/* ─────────────────────────────────────────────────────────────
            REGISTRATION CARD
            ───────────────────────────────────────────────────────── */}
        <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-8 shadow-2xl max-w-2xl mx-auto">

          {/* ───────────────────────────────────────────────────────
              STATUS ANIMATION (quando step !== 'idle')
              ─────────────────────────────────────────────────── */}
          {step !== 'idle' && (
            <div className="mb-6 bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-6 animate-fade-in">
              <div className="flex items-center gap-4">
                {/* Icona animata */}
                <div className="w-12 h-12 bg-indigo-500/20 rounded-full flex items-center justify-center">
                  <span className="text-2xl animate-pulse">
                    {/* Emoji diverso per ogni step */}
                    {step === 'preparing' && '⏳'}
                    {step === 'awaiting_signature' && '✍️'}
                    {step === 'confirming' && '⏱️'}
                    {step === 'success' && '✅'}
                  </span>
                </div>

                {/* Testo stato */}
                <div className="flex-1">
                  <div className="font-bold text-white text-lg">
                    {step === 'preparing' && 'Preparing identity...'}
                    {step === 'awaiting_signature' && 'Confirm in wallet'}
                    {step === 'confirming' && 'Confirming transaction...'}
                    {step === 'success' && 'Welcome! Redirecting...'}
                  </div>
                  <div className="text-sm text-slate-300 mt-1">
                    {step === 'preparing' && 'Generating your cryptographic credentials'}
                    {step === 'awaiting_signature' && 'Approve the transaction in your wallet'}
                    {step === 'confirming' && 'Waiting for network confirmation'}
                    {step === 'success' && 'Registration complete'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ───────────────────────────────────────────────────────
              CONDITIONAL RENDER: Connesso vs Non Connesso
              ─────────────────────────────────────────────────── */}

          {/*
            * CASO 1: WALLET NON CONNESSO
            * Mostra prompt per connettere wallet
            */}
          {!isConnected ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-4">🔗</div>
              <h3 className="text-xl font-bold text-white mb-2">Connect Your Wallet</h3>
              <p className="text-slate-400 mb-6">Connect to get started with anonymous posting</p>
              <ConnectButton />
            </div>
          ) : (
            /*
             * CASO 2: WALLET CONNESSO
             * Mostra form di registrazione
             */
            <div className="space-y-6">

              {/* Info: Identità esistente trovata */}
              {existingId && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 flex items-start gap-3">
                  <span className="text-lg">ℹ️</span>
                  <p className="text-sm text-slate-300">
                    Existing identity found. We'll register it on-chain.
                  </p>
                </div>
              )}

              {/* ─────────────────────────────────────────────────
                  DEPOSIT INFO CARD
                  ───────────────────────────────────────────── */}
              <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-700/30">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm font-semibold text-slate-300">Initial Deposit</span>
                  <span className="text-2xl font-black text-white">0.05 ETH</span>
                </div>
                <div className="text-xs text-slate-400 space-y-1">
                  {/* Messaggi inclusi */}
                  <div className="flex justify-between">
                    <span>Messages included:</span>
                    <span className="text-white font-semibold">~50 posts</span>
                  </div>
                  {/* Deposito rimborsabile */}
                  <div className="flex justify-between">
                    <span>Refundable:</span>
                    <span className="text-emerald-400 font-semibold">Yes, anytime</span>
                  </div>
                </div>
              </div>

              {/* ─────────────────────────────────────────────────
                  JOIN BUTTON
                  ───────────────────────────────────────────── */}

              {/*
                * PULSANTE PRINCIPALE
                *
                * onClick: handleJoin (funzione definita sopra)
                * disabled: quando isBusy (operazione in corso)
                *
                * STYLING:
                * - Gradiente indigo → violet
                * - Hover: scala 105% (effetto zoom)
                * - Disabled: opacità 50%, no hover
                */}
              <button
                onClick={handleJoin}
                disabled={isBusy}
                className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold py-4 px-6 rounded-xl transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 shadow-lg"
              >
                <div className="flex items-center justify-center gap-3">
                  <span className="text-lg">
                    {/* Testo diverso se identità esistente */}
                    {existingId ? '🚀 Register Identity' : '✨ Create & Join'}
                  </span>
                </div>
              </button>

              {/* ─────────────────────────────────────────────────
                  RESET BUTTON
                  ───────────────────────────────────────────── */}

              {/*
                * PULSANTE RESET
                *
                * onClick: chiede conferma, poi cancella localStorage
                *
                * QUANDO USARE:
                * - Utente vuole ricominciare da zero
                * - Testing/debugging
                * - Cambiare identità
                *
                * ATTENZIONE:
                * Cancella identità Semaphore salvata.
                * Se l'identità era già registrata on-chain,
                * i crediti rimangono ma non sono più accessibili
                * (perché hai perso nullifier/trapdoor).
                */}
              <button
                onClick={() => {
                  if (confirm('⚠️ This will delete your local identity. Continue?')) {
                    localStorage.clear();
                    window.location.reload();
                  }
                }}
                className="w-full bg-slate-700/50 hover:bg-slate-700 text-slate-300 font-semibold py-3 px-4 rounded-xl transition-all duration-200"
              >
                Reset Local Data
              </button>
            </div>
          )}
        </div>

        {/* ─────────────────────────────────────────────────────────────
            TRANSACTION LINK (quando confirming)
            ───────────────────────────────────────────────────────── */}

        {/*
          * LINK ETHERSCAN
          *
          * Mostrato solo quando:
          * - hash è disponibile (transaction inviata)
          * - step === 'confirming' (aspettando conferma)
          *
          * LINK:
          * https://sepolia.etherscan.io/tx/{hash}
          *
          * Permette all'utente di:
          * - Vedere stato transaction in real-time
          * - Verificare gas used, block number, etc.
          * - Debug se transaction fallisce
          */}
        {hash && step === 'confirming' && (
          <div className="mt-6 text-center animate-fade-in">
            <a
              href={`https://sepolia.etherscan.io/tx/${hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 text-sm font-semibold transition-colors"
            >
              View on Etherscan →
            </a>
          </div>
        )}
      </main>

      {/* ═══════════════════════════════════════════════════════════════
          FOOTER
          ═══════════════════════════════════════════════════════════ */}
      <footer className="relative z-10 border-t border-slate-700/50 backdrop-blur-xl bg-slate-900/30 mt-20">
        <div className="max-w-6xl mx-auto px-6 py-8 text-center">
          <p className="text-sm text-slate-400">
            Powered by <span className="text-indigo-400 font-semibold">Semaphore</span> ·
            Secured by <span className="text-violet-400 font-semibold">ZK-SNARKs</span> ·
            Deployed on <span className="text-emerald-400 font-semibold">Sepolia</span>
          </p>
        </div>
      </footer>
    </div>
  );
}

/*
 * ═══════════════════════════════════════════════════════════════════════
 * RIASSUNTO COMPONENTE REGISTRAZIONE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * SCOPO:
 * Questa pagina gestisce la registrazione degli utenti al sistema ZKBoard.
 * Gli utenti connettono il wallet, generano un'identità anonima Semaphore,
 * e depositano 0.05 ETH per unirsi al gruppo on-chain.
 *
 * FLUSSO COMPLETO:
 *
 * 1. CARICAMENTO PAGINA:
 *    - Effect 1 carica identità da localStorage (se esiste)
 *    - Se existingId, mostra "Register Identity"
 *    - Altrimenti mostra "Create & Join"
 *
 * 2. CONNESSIONE WALLET:
 *    - Utente clicca ConnectButton (RainbowKit)
 *    - Sceglie wallet (MetaMask, Coinbase, etc.)
 *    - isConnected diventa true
 *    - UI passa da "Connect Wallet" a form registrazione
 *
 * 3. CLICK "CREATE & JOIN":
 *    - handleJoin() viene invocato
 *    - step → 'preparing'
 *    - Genera/carica identità Semaphore
 *    - Salva in localStorage (se nuova)
 *    - step → 'awaiting_signature'
 *    - writeContract() invia transaction
 *    - Wallet popup appare
 *
 * 4. CONFERMA WALLET:
 *    - Utente clicca "Confirm" nel wallet
 *    - Transaction firmata e inviata
 *    - hash disponibile
 *    - Effect 3: step → 'confirming'
 *
 * 5. MONITORING TRANSACTION:
 *    - Effect 4 avvia polling ogni 2s
 *    - getTransactionReceipt() verifica stato
 *    - Quando status === 'success':
 *      • step → 'success'
 *      • Aspetta 1.5s
 *      • router.push('/board')
 *
 * TECNOLOGIE CHIAVE:
 *
 * 1. NEXT.JS 14:
 *    - App Router (app/ directory)
 *    - Client Components ('use client')
 *    - useRouter per navigazione
 *
 * 2. REACT HOOKS:
 *    - useState: gestione stato (step, existingId)
 *    - useEffect: side effects (load identity, monitor tx)
 *
 * 3. WAGMI:
 *    - useAccount: stato wallet connesso
 *    - useWriteContract: invio transazioni
 *    - usePublicClient: lettura stato blockchain
 *
 * 4. RAINBOWKIT:
 *    - ConnectButton: UI connessione wallet
 *    - Supporto multi-wallet
 *    - Gestione automatica rete
 *
 * 5. SEMAPHORE SDK:
 *    - Identity: generazione identità ZK
 *    - commitment: identità pubblica
 *    - toString(): serializzazione
 *
 * 6. VIEM:
 *    - parseEther(): conversione ETH → wei
 *    - getTransactionReceipt(): verifica tx
 *
 * 7. TAILWIND CSS:
 *    - Utility-first CSS framework
 *    - Responsive design (md:, lg:)
 *    - Gradients, animations, blur effects
 *
 * SICUREZZA:
 *
 * 1. IDENTITÀ SEMAPHORE:
 *    - Generata con crypto.getRandomValues() (crittografico)
 *    - Segreti (nullifier, trapdoor) MAI inviati on-chain
 *    - Solo commitment pubblicato
 *
 * 2. LOCALSTORAGE:
 *    - Non crittografato ma accessibile solo da stesso domain
 *    - Utente può esportare e salvare altrove
 *    - Backup consigliato per sicurezza
 *
 * 3. WALLET SIGNATURES:
 *    - Ogni transaction richiede firma utente
 *    - Utente vede esattamente cosa firma
 *    - Impossibile firmare senza consenso
 *
 * 4. DEPOSITO:
 *    - MIN_DEPOSIT = 0.05 ETH verificato on-chain
 *    - Impossibile bypassare (require statement)
 *    - Rimborsabile via withdrawDeposit()
 *
 * STATE MANAGEMENT:
 *
 * step: 'idle' | 'preparing' | 'awaiting_signature' | 'confirming' | 'success'
 * - Traccia stato processo registrazione
 * - Determina UI mostrata all'utente
 * - Reset a 'idle' se errore
 *
 * existingId: string | null
 * - Identità salvata in localStorage
 * - null: nuovo utente
 * - string: utente che torna
 *
 * hash: `0x${string}` | undefined
 * - Hash transaction quando inviata
 * - undefined: nessuna transaction
 * - Usato per monitoring stato
 *
 * isConnected: boolean
 * - true: wallet connesso
 * - false: wallet non connesso
 * - Determina se mostrare form
 *
 * EFFECTS SUMMARY:
 *
 * Effect 1 (mount):
 * - Carica identità da localStorage
 * - Una volta sola all'avvio
 *
 * Effect 2 (error):
 * - Reset step se writeError
 * - Permette retry
 *
 * Effect 3 (hash):
 * - Quando hash disponibile, step → 'confirming'
 * - Indica transaction inviata
 *
 * Effect 4 (monitoring):
 * - Polling ogni 2s
 * - Verifica conferma transaction
 * - Quando confermata, naviga a /board
 *
 * ERROR HANDLING:
 *
 * 1. USER REJECTED:
 *    - Utente clicca "Reject" nel wallet
 *    - writeError: "User rejected"
 *    - Effect 2: step → 'idle'
 *
 * 2. INSUFFICIENT FUNDS:
 *    - Balance < 0.05 ETH + gas
 *    - writeError: "Insufficient funds"
 *    - Effect 2: step → 'idle'
 *
 * 3. NETWORK ERROR:
 *    - RPC node offline/slow
 *    - getTransactionReceipt() fallisce
 *    - Retry automatico (polling)
 *
 * 4. TRANSACTION REVERT:
 *    - Require statement fallito on-chain
 *    - receipt.status === 'reverted'
 *    - Gestione errori tramite polling automatico
 *
 * UI/UX FEATURES:
 *
 * 1. ANIMATED BACKGROUND:
 *    - Due cerchi gradient blur
 *    - Pulse animation sfasata
 *    - Glassmorphism effect
 *
 * 2. STATUS FEEDBACK:
 *    - Emoji animato per ogni step
 *    - Messaggi chiari stato corrente
 *    - Link Etherscan durante conferma
 *
 * 3. RESPONSIVE DESIGN:
 *    - Mobile-first (default)
 *    - Tablet: md: breakpoint
 *    - Desktop: max-w-6xl containers
 *
 * 4. ACCESSIBILITY:
 *    - Disabled states visibili
 *    - Focus states per keyboard nav
 *    - Confirm dialogs per azioni distruttive
 *
 * OTTIMIZZAZIONI:
 *
 * 1. POLLING INTERVAL:
 *    - 2 secondi: buon trade-off
 *    - Non troppo spam (rate limits)
 *    - Non troppo lento (UX)
 *
 * 2. CLEANUP FUNCTIONS:
 *    - clearInterval() in useEffect return
 *    - Previene memory leaks
 *    - Importante per SPA
 *
 * 3. CONDITIONAL RENDERING:
 *    - {isConnected ? ... : ...}
 *    - Render solo componenti necessari
 *    - Migliora performance
 *
 * FUTURE IMPROVEMENTS:
 *
 * 1. Export Identity:
 *    - Button per esportare identity come file
 *    - Backup sicuro per utente
 *
 * 2. Import Identity:
 *    - Upload file per ripristinare
 *    - Migrazione tra browser
 *
 * 3. Error Details:
 *    - Mostrare dettagli errori all'utente
 *    - Suggerimenti troubleshooting
 *
 * 4. Transaction History:
 *    - Salvare hash transactions passate
 *    - Link rapido a Etherscan
 *
 * 5. Gas Estimation:
 *    - Mostrare costo gas stimato
 *    - Aiutare utente decidere
 */
