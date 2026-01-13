/*
 * ═══════════════════════════════════════════════════════════════════════
 * PAGINA BOARD - BACHECA MESSAGGI ANONIMI
 * ═══════════════════════════════════════════════════════════════════════
 *
 * DESCRIZIONE:
 * Questa è la pagina principale dove gli utenti postano messaggi anonimi.
 * Include la generazione completa di Zero-Knowledge Proofs usando snarkjs.
 *
 * FLUSSO COMPLETO:
 * 1. Carica identità da localStorage
 * 2. Sincronizza con API per verificare membership nel gruppo
 * 3. Utente scrive messaggio
 * 4. Sistema genera ZK proof (prova di appartenenza senza rivelare identità)
 * 5. Crea relay request on-chain
 * 6. Relayer esegue la request
 * 7. Messaggio appare nella board
 *
 * TECNOLOGIE:
 * - snarkjs: Libreria JavaScript per generare proof Groth16
 * - Semaphore SDK: Gestione identità e gruppi
 * - Wagmi/Viem: Interazione Ethereum
 * - Next.js 14: Framework React
 *
 * COMPONENTI PRINCIPALI:
 * - handlePost(): Generazione proof ZK (righe 121-198)
 * - syncWithApi(): Verifica membership (righe 74-93)
 * - loadMessages(): Caricamento messaggi da eventi (righe 37-47)
 *
 * SICUREZZA:
 * - Proof generata localmente nel browser (nessun server coinvolto)
 * - Segreti (nullifier, trapdoor) MAI inviati on-chain
 * - Solo nullifierHash e proof vengono pubblicati
 * - Impossibile collegare messaggio a identità
 */

'use client';

// ═══════════════════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════════════════

/*
 * REACT HOOKS
 *
 * useState: Stato locale del componente
 * useEffect: Side effects (caricamento dati, timers)
 * Suspense: Loading state per componenti async
 * useCallback: Memoizza funzioni per ottimizzare performance
 */
import { useState, useEffect, Suspense, useCallback } from 'react';

/*
 * NEXT.JS NAVIGATION
 * useRouter: Navigazione programmatica (redirect a home se no identity)
 */
import { useRouter } from 'next/navigation';

/*
 * RAINBOWKIT
 * ConnectButton: UI per connessione wallet
 */
import { ConnectButton } from '@rainbow-me/rainbowkit';

/*
 * WAGMI HOOKS
 *
 * useAccount: Info wallet connesso
 * useWriteContract: Invia transazioni write
 * useWaitForTransactionReceipt: Monitora conferma transaction
 * usePublicClient: Client per read operations
 */
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';

/*
 * SEMAPHORE SDK
 *
 * Identity: Gestione identità anonima (nullifier + trapdoor)
 * Group: Ricostruzione Merkle tree locale per proof generation
 *
 * PERCHÉ RICOSTRUIRE IL GROUP LOCALMENTE:
 * Per generare una proof ZK, serve il Merkle path dalla nostra foglia al root.
 * Il contratto on-chain non espone i path (troppo costoso in gas).
 * Quindi ricostruiamo l'intero albero nel browser usando la stessa logica.
 */
import { Identity } from '@semaphore-protocol/identity';
import { Group } from '@semaphore-protocol/group';

/*
 * VIEM UTILITIES
 *
 * encodePacked: Codifica dati per hashing (equivalente abi.encodePacked)
 * keccak256: Hash function (SHA3)
 * parseEther: Converte ETH in wei
 */
import { encodePacked, keccak256, parseEther } from 'viem';

/*
 * SNARKJS
 *
 * Libreria JavaScript per generare e verificare proof Groth16.
 *
 * GROTH16:
 * - Tipo di ZK-SNARK molto efficiente
 * - Proof compatte (~192 bytes)
 * - Verifica veloce on-chain (~300k gas)
 * - Usata da Semaphore, Tornado Cash, zkSync
 *
 * @ts-ignore: Disabilita type checking (snarkjs ha problemi di typing)
 */
// @ts-ignore
import * as snarkjs from 'snarkjs';

/*
 * CONSTANTS & COMPONENTS
 */
import { ZKBOARD_ABI, ZKBOARD_ADDRESS, FALLBACK_GROUP_ID } from '../utils/constants';
import DepositManager from '../components/DepositManager';

// ═══════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Message - Struttura messaggio letto dall'API
 *
 * NOTA: I messaggi NON sono salvati in un array on-chain,
 * ma solo negli eventi MessagePosted. L'API li legge dagli eventi.
 */
interface Message {
  text: string;        // Contenuto del messaggio
  timestamp: number;   // Unix timestamp (secondi)
}

/**
 * PostingStep - Stati del processo di posting
 *
 * FLUSSO:
 * idle → generating_proof → awaiting_signature → request_submitted → success → idle
 *
 * TEMPI (tipici):
 * - generating_proof: 5-15 secondi (dipende da CPU)
 * - awaiting_signature: attesa utente
 * - request_submitted: ~15 secondi (block time Sepolia)
 * - success: 3 secondi (feedback UI)
 */
type PostingStep = 'idle' | 'generating_proof' | 'awaiting_signature' | 'request_submitted' | 'success';

// ═══════════════════════════════════════════════════════════════════════
// BOARD CONTENT COMPONENT
// ═══════════════════════════════════════════════════════════════════════

/**
 * BoardContent - Componente principale della bacheca
 *
 * RESPONSABILITÀ:
 * 1. Gestione identità (load da localStorage)
 * 2. Sincronizzazione con gruppo on-chain
 * 3. Caricamento messaggi
 * 4. Generazione proof ZK
 * 5. Creazione relay request
 * 6. Rendering UI
 */
function BoardContent() {
  // ═══════════════════════════════════════════════════════════════════
  // HOOKS SETUP
  // ═══════════════════════════════════════════════════════════════════

  const router = useRouter();
  const { address } = useAccount();

  // ═══════════════════════════════════════════════════════════════════
  // STATE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════

  /*
   * message - Testo del messaggio che l'utente sta scrivendo
   */
  const [message, setMessage] = useState('');

  /*
   * isReady - Flag che indica se l'identità è sincronizzata con blockchain
   *
   * false: Stiamo ancora verificando se l'identità è nel gruppo on-chain
   * true: Identità confermata nel gruppo, possiamo postare
   *
   * IMPORTANTE: Dobbiamo aspettare isReady=true prima di generare proof,
   * altrimenti la proof generation potrebbe fallire (identità non nel tree).
   */
  const [isReady, setIsReady] = useState(false);

  /*
   * identity - Identità Semaphore dell'utente
   *
   * null: Nessuna identità (non registrato o errore)
   * Identity: Oggetto con nullifier, trapdoor, commitment
   *
   * STRUTTURA IDENTITY:
   * {
   *   nullifier: BigInt (segreto),
   *   trapdoor: BigInt (segreto),
   *   commitment: BigInt (pubblico, = poseidon(nullifier, trapdoor))
   * }
   */
  const [identity, setIdentity] = useState<Identity | null>(null);

  /*
   * messages - Array di messaggi caricati dalla board
   *
   * Aggiornato ogni 15 secondi tramite polling all'API /api/logs
   */
  const [messages, setMessages] = useState<Message[]>([]);

  /*
   * postingStep - Stato corrente del processo di posting
   *
   * Usato per mostrare feedback UI all'utente e disabilitare form
   */
  const [postingStep, setPostingStep] = useState<PostingStep>('idle');

  /*
   * relayFee - Fee da pagare al relayer (in ETH)
   *
   * Default: 0.001 ETH (~$2-3)
   *
   * TRADE-OFF:
   * - Fee alta: messaggio relayato velocemente (incentivo per relayer)
   * - Fee bassa: potrebbe aspettare più tempo
   *
   * NOTA: La fee viene pagata dal contratto al relayer quando esegue.
   * Non viene addebitata direttamente all'utente (viene dal deposito).
   */
  const [relayFee, setRelayFee] = useState('0.001');

  /*
   * WAGMI HOOKS
   */
  const publicClient = usePublicClient();
  const { data: hash, writeContract, isPending, error: writeError } = useWriteContract();
  const { isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  // ═══════════════════════════════════════════════════════════════════
  // LOAD MESSAGES
  // ═══════════════════════════════════════════════════════════════════

  /**
   * loadMessages - Carica messaggi dalla board tramite API
   *
   * FLUSSO:
   * 1. Chiama GET /api/logs
   * 2. API scansiona eventi MessagePosted della blockchain
   * 3. Ritorna array di messaggi ordinati per timestamp
   * 4. Aggiorna state messages
   *
   * POLLING:
   * Viene chiamata ogni 15 secondi per aggiornare la board
   * (vedi useEffect riga 49)
   *
   * useCallback:
   * Memoizza la funzione per evitare re-creazione a ogni render.
   * Importante perché questa funzione è dependency di un useEffect.
   */
  const loadMessages = useCallback(async () => {
    try {
      // Chiama API senza cache (sempre fresh data)
      const response = await fetch('/api/logs', { cache: 'no-store' });
      const data = await response.json();

      // Verifica che data.messages sia un array valido
      if (data.messages && Array.isArray(data.messages)) {
        setMessages(data.messages);
      }
    } catch (error) {
      console.error('Error loading messages:', error);
      // Non facciamo nulla, riproveremo tra 15 secondi
    }
  }, []); // [] = nessuna dependency, funzione stabile

  // ═══════════════════════════════════════════════════════════════════
  // EFFECTS - MESSAGES POLLING
  // ═══════════════════════════════════════════════════════════════════

  /**
   * EFFECT 1: Polling messaggi ogni 15 secondi
   *
   * QUANDO ESEGUE:
   * - Mount del componente (caricamento iniziale)
   * - Ogni 15 secondi (setInterval)
   *
   * CLEANUP:
   * clearInterval() quando componente unmount
   */
  useEffect(() => {
    // Caricamento iniziale
    loadMessages();

    // Setup polling ogni 15 secondi
    const interval = setInterval(loadMessages, 15000);

    // Cleanup: ferma polling quando componente viene rimosso
    return () => clearInterval(interval);
  }, [loadMessages]); // Ri-esegui se loadMessages cambia (ma non cambia mai)

  // ═══════════════════════════════════════════════════════════════════
  // EFFECTS - POSTING STATE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════

  /**
   * EFFECT 2: Reset step se errore
   */
  useEffect(() => {
    if (writeError) setPostingStep('idle');
  }, [writeError]);

  /**
   * EFFECT 3: Aggiorna step quando hash disponibile
   */
  useEffect(() => {
    if (hash) setPostingStep('request_submitted');
  }, [hash]);

  /**
   * EFFECT 4: Success flow
   *
   * Quando transaction confermata:
   * 1. Mostra "Success" per 3 secondi
   * 2. Reset form
   * 3. Ricarica messaggi
   */
  useEffect(() => {
    if (isConfirmed) {
      setPostingStep('success');

      setTimeout(() => {
        setPostingStep('idle');
        setMessage('');
        loadMessages();
      }, 3000);
    }
  }, [isConfirmed, loadMessages]);

  // ═══════════════════════════════════════════════════════════════════
  // SYNC WITH API - MEMBERSHIP VERIFICATION
  // ═══════════════════════════════════════════════════════════════════

  /**
   * syncWithApi - Verifica se l'identità è nel gruppo on-chain
   *
   * PROBLEMA:
   * L'utente ha appena registrato l'identità on-chain (joinGroupWithDeposit).
   * Ma la transaction potrebbe non essere ancora confermata, o l'API
   * potrebbe non averla ancora indicizzata.
   *
   * SOLUZIONE:
   * Polling ogni 5 secondi finché l'identità appare nella lista membri.
   *
   * FLUSSO:
   * 1. Ottieni commitment dell'identità
   * 2. Chiama API /api/logs per lista membri
   * 3. Se commitment è nella lista → setIsReady(true)
   * 4. Altrimenti riprova tra 5 secondi
   *
   * IMPORTANTE:
   * Questa funzione si chiama ricorsivamente tramite setTimeout.
   * Non usa setInterval perché vogliamo aspettare il completamento
   * della chiamata API prima di fare la prossima.
   */
  const syncWithApi = useCallback(async (id: Identity) => {
    try {
      // Ottieni il commitment pubblico di questa identità
      const myCommitment = id.commitment.toString();

      // Chiama API per lista membri
      const response = await fetch('/api/logs', { cache: 'no-store' });
      const data = await response.json();

      // Verifica che data.members esista e sia array
      if (!data.members || !Array.isArray(data.members)) {
        // Dati non validi, riprova tra 5 secondi
        setTimeout(() => syncWithApi(id), 5000);
        return;
      }

      // Controlla se il nostro commitment è nella lista
      if (data.members.includes(myCommitment)) {
        // TROVATO! Siamo nel gruppo on-chain
        setIsReady(true);
      } else {
        // Non ancora trovato, riprova tra 5 secondi
        setTimeout(() => syncWithApi(id), 5000);
      }
    } catch (e: any) {
      // Errore di rete o API, riprova tra 5 secondi
      setTimeout(() => syncWithApi(id), 5000);
    }
  }, []); // Funzione stabile

  // ═══════════════════════════════════════════════════════════════════
  // EFFECT - IDENTITY LOADING
  // ═══════════════════════════════════════════════════════════════════

  /**
   * EFFECT 5: Carica identità da localStorage e avvia sync
   *
   * QUANDO ESEGUE:
   * - Mount del componente
   *
   * FLUSSO:
   * 1. Legge 'ZK_USER_ID' da localStorage
   * 2. Se non esiste → redirect a home (non registrato)
   * 3. Ricostruisce Identity object da stringa
   * 4. Verifica che Identity sia valida (ha nullifier e trapdoor)
   * 5. Salva in state
   * 6. Avvia syncWithApi per verificare membership
   */
  useEffect(() => {
    // STEP 1: Leggi da localStorage
    const saved = localStorage.getItem('ZK_USER_ID');

    if (!saved) {
      // Nessuna identità salvata → utente deve registrarsi
      router.push('/');
      return;
    }

    try {
      // STEP 2: Ricostruisci Identity object
      const id = new Identity(saved);

      // STEP 3: Verifica che Identity sia valida
      // Alcune versioni della libreria Semaphore usano nomi diversi:
      // - nullifier vs _nullifier
      // - trapdoor vs _trapdoor
      // Controlliamo entrambi i nomi
      const hasNullifier = !!(id as any).nullifier || !!(id as any)._nullifier;
      const hasTrapdoor = !!(id as any).trapdoor || !!(id as any)._trapdoor;

      if (!hasNullifier || !hasTrapdoor) {
        // Identity corrotta o incompatibile
        console.error('Invalid identity: missing nullifier or trapdoor');
        router.push('/');
        return;
      }

      // STEP 4: Salva in state
      setIdentity(id);

      // STEP 5: Avvia sync con blockchain
      syncWithApi(id);
    } catch (e: any) {
      // Errore nel parsing o ricostruzione Identity
      console.error('Failed to restore identity:', e);
      router.push('/');
    }
  }, [syncWithApi, router]); // Re-esegui se cambiano (ma sono stabili)

  // ═══════════════════════════════════════════════════════════════════
  // POST MESSAGE - ZK PROOF GENERATION
  // ═══════════════════════════════════════════════════════════════════

  /**
   * handlePost - Genera proof ZK e crea relay request
   *
   * QUESTO È IL CUORE DELL'APPLICAZIONE!
   *
   * FLUSSO COMPLETO:
   * 1. Carica lista membri dall'API
   * 2. Ricostruisce Merkle tree localmente
   * 3. Trova indice della nostra identità nel tree
   * 4. Genera Merkle proof (path dalla foglia al root)
   * 5. Calcola signal (hash del messaggio)
   * 6. Carica WASM e ZKEY files (circuito ZK compilato)
   * 7. Chiama snarkjs per generare proof Groth16
   * 8. Converte proof in formato Solidity
   * 9. Chiama createRelayRequest on-chain
   *
   * TEMPO TIPICO:
   * - Step 1-6: ~1 secondo
   * - Step 7 (proof generation): 5-15 secondi (dipende da CPU)
   * - Step 8-9: ~1 secondo
   *
   * SICUREZZA:
   * - Tutta la computazione avviene nel browser (client-side)
   * - Nessun server vede nullifier o trapdoor
   * - Solo proof e nullifierHash vengono inviati on-chain
   */
  const handlePost = async () => {
    // ───────────────────────────────────────────────────────────────────
    // VALIDAZIONI PRELIMINARI
    // ───────────────────────────────────────────────────────────────────

    if (!identity || !isReady) return;

    setPostingStep('generating_proof');

    try {
      // ─────────────────────────────────────────────────────────────────
      // STEP 1: CARICA MEMBRI E RICOSTRUISCI GRUPPO
      // ─────────────────────────────────────────────────────────────────

      /*
       * Perché dobbiamo ricostruire il gruppo localmente?
       *
       * Per generare una proof ZK Semaphore, servono:
       * 1. Merkle proof (path dalla nostra foglia al root)
       * 2. Root del tree
       *
       * Il contratto on-chain NON espone i path Merkle (troppo costoso).
       * Quindi dobbiamo ricostruire l'INTERO albero localmente usando
       * la stessa logica (stesso ordine di inserimento).
       */
      const response = await fetch('/api/logs', { cache: 'no-store' });
      const data = await response.json();

      // Converti membri da string a BigInt
      const membersBigInt = data.members.map((m: string) => BigInt(m));

      // Crea nuovo Group object (Merkle tree vuoto)
      // FALLBACK_GROUP_ID: ID del gruppo (deve matchare on-chain)
      // 20: profondità del tree (2^20 = 1M membri max)
      const group = new Group(FALLBACK_GROUP_ID, 20);

      // Aggiungi tutti i membri nell'STESSO ORDINE del contratto
      // CRITICAL: L'ordine DEVE essere identico altrimenti il root sarà diverso!
      for (const member of membersBigInt) group.addMember(member);

      // ─────────────────────────────────────────────────────────────────
      // STEP 2: TROVA INDICE DELLA NOSTRA IDENTITÀ
      // ─────────────────────────────────────────────────────────────────

      /*
       * indexOf() cerca il commitment nel tree e ritorna l'indice
       *
       * ESEMPIO:
       * Se ci sono 8 membri e il nostro commitment è il 5°:
       * index = 4 (zero-indexed)
       */
      const index = group.indexOf(identity.commitment);

      if (index === -1) {
        throw new Error('Your identity is not in the local group. Please reload.');
      }

      // ─────────────────────────────────────────────────────────────────
      // STEP 3: GENERA MERKLE PROOF
      // ─────────────────────────────────────────────────────────────────

      /*
       * generateMerkleProof() ritorna il path dalla foglia al root
       *
       * STRUTTURA MERKLE PROOF:
       * {
       *   pathIndices: [0, 1, 0, 1, ...],  // Left=0, Right=1 per ogni livello
       *   pathElements: [hash1, hash2, ...] // Sibling hash per ogni livello
       * }
       *
       * ESEMPIO con tree depth=3, index=5:
       *                     root
       *                   /      \
       *                 h1        h2
       *               /   \      /   \
       *             h3    h4   h5    h6
       *            / \   / \  / \   / \
       *           L0 L1 L2 L3 L4 L5 L6 L7
       *
       * Per L5 (index=5):
       * - Livello 0: sibling=L4 (sinistra), indice=1 (siamo a destra)
       * - Livello 1: sibling=h3 (sinistra), indice=1 (siamo a destra)
       * - Livello 2: sibling=h1 (sinistra), indice=1 (siamo a destra)
       *
       * pathIndices = [1, 1, 1]
       * pathElements = [L4, h3, h1]
       */
      const merkleProof = group.generateMerkleProof(index);

      // ─────────────────────────────────────────────────────────────────
      // STEP 4: CALCOLA SIGNAL (hash del messaggio)
      // ─────────────────────────────────────────────────────────────────

      /*
       * Il signal è l'hash del messaggio, usato come input pubblico della proof
       *
       * PROCESSO:
       * 1. encodePacked(['string'], [message]) → codifica il messaggio
       * 2. keccak256(...) → hash SHA3 (256 bit)
       * 3. >> BigInt(8) → shift right 8 bit (254 bit finali)
       *
       * PERCHÉ >> 8:
       * Lo SNARK field è ~254 bit (non 256!).
       * Rimuovendo 8 bit garantiamo che il numero sia valido nel field.
       */
      const signal = BigInt(keccak256(encodePacked(['string'], [message]))) >> BigInt(8);

      // ─────────────────────────────────────────────────────────────────
      // STEP 5: CARICA WASM E ZKEY FILES
      // ─────────────────────────────────────────────────────────────────

      /*
       * WASM FILE (semaphore.wasm):
       * - Circuito ZK compilato in WebAssembly
       * - Contiene la logica di witness generation
       * - ~5-10 MB
       *
       * ZKEY FILE (semaphore.zkey):
       * - Proving key del circuito
       * - Generata durante setup ceremony
       * - Contiene parametri crittografici per proof generation
       * - ~50-100 MB
       *
       * DOVE SONO:
       * - public/semaphore/semaphore.wasm
       * - public/semaphore/semaphore.zkey
       *
       * Questi file vengono scaricati dal browser la prima volta,
       * poi cachati per usi futuri.
       */
      const wasmResponse = await fetch('/semaphore/semaphore.wasm');
      const wasmBuffer = await wasmResponse.arrayBuffer();

      const zkeyResponse = await fetch('/semaphore/semaphore.zkey');
      const zkeyBuffer = await zkeyResponse.arrayBuffer();

      // ─────────────────────────────────────────────────────────────────
      // STEP 6: ESTRAI NULLIFIER E TRAPDOOR
      // ─────────────────────────────────────────────────────────────────

      /*
       * Versioni diverse della libreria Semaphore usano nomi diversi:
       * - Semaphore v3: nullifier, trapdoor (pubblici)
       * - Semaphore v4: _nullifier, _trapdoor (privati)
       *
       * Proviamo entrambi i nomi per compatibilità
       */
      const identityNullifier =
        (identity as any).nullifier?.toString() || (identity as any)._nullifier?.toString();
      const identityTrapdoor =
        (identity as any).trapdoor?.toString() || (identity as any)._trapdoor?.toString();

      if (!identityNullifier || !identityTrapdoor) {
        throw new Error("Incompatible identity. Reset your data on the home page.");
      }

      // ─────────────────────────────────────────────────────────────────
      // STEP 7: LEGGI MESSAGE COUNTER DALLA BLOCKCHAIN
      // ─────────────────────────────────────────────────────────────────

      /*
       * Leggiamo messageCounter dal contratto per usarlo come externalNullifier.
       * Questo permette alla stessa identità di postare messaggi multipli,
       * generando un nullifierHash diverso per ogni messaggio.
       */
      const currentMessageCounter = await publicClient?.readContract({
        address: ZKBOARD_ADDRESS,
        abi: ZKBOARD_ABI,
        functionName: 'messageCounter',
      }) as bigint;

      // ─────────────────────────────────────────────────────────────────
      // STEP 8: PREPARA INPUT DEL CIRCUITO
      // ─────────────────────────────────────────────────────────────────

      /*
       * Il circuito Semaphore si aspetta questi input:
       *
       * INPUT PRIVATI (witness):
       * - identityNullifier: segreto dell'identità
       * - identityTrapdoor: segreto dell'identità
       * - treePathIndices: path nel Merkle tree (left/right)
       * - treeSiblings: hash dei sibling nel path
       *
       * INPUT PUBBLICI (public signals):
       * - signalHash: hash del messaggio
       * - externalNullifier: messageCounter (permette messaggi multipli)
       *
       * NOTA: merkleTreeRoot viene calcolato DAL CIRCUITO usando
       * identityCommitment + treePathIndices + treeSiblings.
       * Poi viene verificato che il root calcolato sia corretto.
       */
      const circuitInput = {
        // Segreti dell'identità
        identityNullifier,
        identityTrapdoor,

        // Merkle proof (compatibilità con diverse versioni SDK)
        treePathIndices: merkleProof.pathIndices || merkleProof.indices,
        treeSiblings: (merkleProof.pathElements || merkleProof.siblings).map((s: any) => s.toString()),

        // Signal pubblico
        signalHash: signal.toString(),

        // External nullifier (usiamo messageCounter per permettere messaggi multipli)
        externalNullifier: currentMessageCounter.toString(),
      };

      // ─────────────────────────────────────────────────────────────────
      // STEP 8: GENERA PROOF ZK CON SNARKJS
      // ─────────────────────────────────────────────────────────────────

      /*
       * snarkjs.groth16.fullProve()
       *
       * COSA FA:
       * 1. Calcola witness (valori intermedi del circuito)
       * 2. Genera proof Groth16 usando proving key
       * 3. Estrae public signals
       *
       * TEMPO: 5-15 secondi (dipende da CPU)
       *
       * PERCHÉ È LENTO:
       * - Il circuito Semaphore ha ~280k constraints
       * - Serve calcolare FFT (Fast Fourier Transform) su curve ellittiche
       * - Operazioni crittografiche pesanti
       *
       * RETURN VALUE:
       * {
       *   proof: {
       *     pi_a: [x, y],              // Punto sulla curva BN254
       *     pi_b: [[x1, x2], [y1, y2]], // Coppia di punti
       *     pi_c: [x, y],              // Punto sulla curva
       *   },
       *   publicSignals: [
       *     merkleTreeRoot,
       *     nullifierHash,
       *     signalHash,
       *     externalNullifier
       *   ]
       * }
       */
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        circuitInput,              // Input del circuito
        new Uint8Array(wasmBuffer), // WASM file
        new Uint8Array(zkeyBuffer)  // Proving key
      );

      // ─────────────────────────────────────────────────────────────────
      // STEP 9: CONVERTI PROOF IN FORMATO SOLIDITY
      // ─────────────────────────────────────────────────────────────────

      /*
       * La proof Groth16 ha questa struttura in snarkjs:
       *
       * pi_a: [x, y] → rappresenta punto A sulla curva
       * pi_b: [[x1, x2], [y1, y2]] → rappresenta coppia di punti B
       * pi_c: [x, y] → rappresenta punto C sulla curva
       *
       * Il verifier Solidity si aspetta un array di 8 uint256:
       * [pi_a[0], pi_a[1], pi_b[0][1], pi_b[0][0], pi_b[1][1], pi_b[1][0], pi_c[0], pi_c[1]]
       *
       * NOTA: pi_b ha coordinata x invertita ([1] prima di [0])!
       * Questo è uno standard del pairing BN254.
       */
      const proofArray = [
        BigInt(proof.pi_a[0]),    // A.x
        BigInt(proof.pi_a[1]),    // A.y
        BigInt(proof.pi_b[0][1]), // B.x[1] (NOTA: invertito!)
        BigInt(proof.pi_b[0][0]), // B.x[0]
        BigInt(proof.pi_b[1][1]), // B.y[1] (NOTA: invertito!)
        BigInt(proof.pi_b[1][0]), // B.y[0]
        BigInt(proof.pi_c[0]),    // C.x
        BigInt(proof.pi_c[1]),    // C.y
      ];

      // ─────────────────────────────────────────────────────────────────
      // STEP 10: ESTRAI PUBLIC SIGNALS
      // ─────────────────────────────────────────────────────────────────

      /*
       * publicSignals array contiene:
       * [0] = merkleTreeRoot (calcolato dal circuito)
       * [1] = nullifierHash (derivato da nullifier + externalNullifier)
       * [2] = signalHash (nostro messaggio hashato)
       * [3] = externalNullifier (groupId)
       *
       * IMPORTANTE:
       * - onChainRoot DEVE matchare il root del gruppo on-chain
       * - nullifierHash DEVE essere univoco (previene double-posting)
       */
      const onChainRoot = group.root;           // Root locale (deve matchare on-chain)
      const nullifierHash = BigInt(publicSignals[1]); // Nullifier hash dalla proof

      // ─────────────────────────────────────────────────────────────────
      // STEP 11: CREA RELAY REQUEST ON-CHAIN
      // ─────────────────────────────────────────────────────────────────

      /*
       * Ora abbiamo tutto per creare la relay request!
       *
       * setPostingStep('awaiting_signature'):
       * - UI mostra "Confirm in wallet"
       * - Utente deve approvare transaction
       */
      setPostingStep('awaiting_signature');

      /*
       * createRelayRequest() - Chiamata al contratto ZKBoard
       *
       * PARAMETRI:
       * 1. merkleTreeRoot: Root del tree (per verifica proof)
       * 2. nullifierHash: Previene double-posting
       * 3. proof: Array di 8 uint256 (proof Groth16)
       * 4. message: Testo del messaggio
       * 5. relayFee: Fee per il relayer (in wei)
       * 6. messageIndex: Indice del messaggio (= messageCounter letto prima)
       *
       * COSA SUCCEDE ON-CHAIN:
       * 1. Contratto verifica messageIndex == messageCounter
       * 2. Contratto salva la RelayRequest nello storage
       * 3. Incrementa messageCounter per il prossimo messaggio
       * 4. Assegna ID incrementale alla request
       * 5. Emette evento RelayRequestCreated
       * 6. Relayer vede l'evento e può eseguire la request
       *
       * GAS COST: ~50k gas (molto basso!)
       * Il costo è basso perché NON verifichiamo la proof ora.
       * La verifica (~400k gas) verrà fatta dal relayer in executeRelay().
       */
      writeContract({
        address: ZKBOARD_ADDRESS,
        abi: ZKBOARD_ABI,
        functionName: 'createRelayRequest',
        args: [
          onChainRoot,              // uint256 merkleTreeRoot
          nullifierHash,            // uint256 nullifierHash
          proofArray,               // uint256[8] proof
          message,                  // string message
          parseEther(relayFee),     // uint256 relayFee (converti ETH → wei)
          currentMessageCounter     // uint256 messageIndex
        ],
      });

    } catch (e: any) {
      /*
       * ERROR HANDLING
       *
       * ERRORI POSSIBILI:
       * - Network error (API non risponde)
       * - Identity not in group (non ancora sincronizzato)
       * - WASM/ZKEY fetch failed (file mancanti)
       * - Proof generation failed (input invalidi, bug circuito)
       * - User rejected transaction
       *
       * RISPOSTA:
       * - Log error nella console
       * - Reset a 'idle' (utente può riprovare)
       */
      console.error(e);
      setPostingStep('idle');
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // RENDER UI
  // ═══════════════════════════════════════════════════════════════════

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white relative overflow-hidden">
      {/* ═══════════════════════════════════════════════════════════════
          ANIMATED BACKGROUND
          ═══════════════════════════════════════════════════════════ */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-violet-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }}></div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          HEADER
          ═══════════════════════════════════════════════════════════ */}
      <header className="sticky top-0 z-50 border-b border-slate-700/50 backdrop-blur-xl bg-slate-900/80">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-lg flex items-center justify-center shadow-lg">
              <span className="text-xl font-black">Z</span>
            </div>
            <span className="text-xl font-black tracking-tight">ZK Anonymous Board</span>
          </div>
          <div className="flex items-center gap-4">
            {/* Link alla relay dashboard */}
            <a
              href="/relay"
              className="text-sm font-semibold text-slate-400 hover:text-indigo-400 transition-colors"
            >
              Relay Dashboard
            </a>
            <ConnectButton showBalance={false} chainStatus="icon" />
          </div>
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════════════
          MAIN CONTENT
          ═══════════════════════════════════════════════════════════ */}
      <main className="relative z-10 max-w-7xl mx-auto px-6 py-8">
        <div className="grid lg:grid-cols-3 gap-6">

          {/* ─────────────────────────────────────────────────────────
              LEFT COLUMN - MESSAGES
              ───────────────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-6">

            {/* COMPOSE BOX */}
            <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-xl">
              <h2 className="text-xl font-bold text-white mb-4">Compose Message</h2>

              {/* Message Textarea */}
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Write your anonymous message..."
                className="w-full bg-slate-900/50 border border-slate-700/50 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none resize-none transition-colors"
                rows={4}
                disabled={!isReady || postingStep !== 'idle'}
              />

              {/* Relay Fee + Post Button */}
              <div className="mt-4 flex items-end gap-4">
                <div className="flex-1">
                  <label className="text-xs text-slate-400 mb-2 block">Relay Fee (ETH)</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={relayFee}
                    onChange={(e) => setRelayFee(e.target.value)}
                    className="w-full bg-slate-900/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none transition-colors"
                    disabled={!isReady || postingStep !== 'idle'}
                  />
                  <div className="text-xs text-slate-500 mt-1">
                    Higher fees get relayed faster
                  </div>
                </div>

                <button
                  onClick={handlePost}
                  disabled={!isReady || !message.trim() || postingStep !== 'idle'}
                  className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:from-slate-700 disabled:to-slate-700 text-white font-bold py-3 px-8 rounded-xl transition-all duration-200 hover:scale-105 disabled:hover:scale-100 disabled:opacity-50 shadow-lg"
                >
                  {postingStep === 'idle' ? 'Post' : 'Processing...'}
                </button>
              </div>

              {/* ───────────────────────────────────────────────────
                  STATUS ANIMATION
                  ─────────────────────────────────────────────── */}
              {postingStep !== 'idle' && (
                <div className="mt-4 bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-4 animate-fade-in">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-500/20 rounded-full flex items-center justify-center">
                      <span className="text-xl animate-pulse">
                        {postingStep === 'generating_proof' && '🔐'}
                        {postingStep === 'awaiting_signature' && '✍️'}
                        {postingStep === 'request_submitted' && '⏱️'}
                        {postingStep === 'success' && '✅'}
                      </span>
                    </div>
                    <div className="flex-1">
                      <div className="font-bold text-white">
                        {postingStep === 'generating_proof' && 'Generating ZK proof...'}
                        {postingStep === 'awaiting_signature' && 'Confirm in wallet'}
                        {postingStep === 'request_submitted' && 'Request submitted'}
                        {postingStep === 'success' && 'Success!'}
                      </div>
                      <div className="text-sm text-slate-300">
                        {postingStep === 'generating_proof' && 'Creating zero-knowledge proof locally'}
                        {postingStep === 'awaiting_signature' && 'Approve the relay request transaction'}
                        {postingStep === 'request_submitted' && 'Waiting for a relayer to process your message'}
                        {postingStep === 'success' && 'Your message will appear soon'}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ───────────────────────────────────────────────────
                  SYNCING WARNING
                  ─────────────────────────────────────────────── */}
              {!isReady && (
                <div className="mt-4 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">⏳</span>
                    <div className="text-sm text-slate-300">
                      Syncing with blockchain... Please wait.
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ─────────────────────────────────────────────────────
                MESSAGES FEED
                ───────────────────────────────────────────────── */}
            <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-white">Messages</h2>
                <div className="text-sm text-slate-400">
                  {messages.length} total
                </div>
              </div>

              <div className="space-y-3 max-h-[600px] overflow-y-auto custom-scrollbar">
                {messages.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-4xl mb-3">📭</div>
                    <p className="text-slate-400">No messages yet. Be the first to post!</p>
                  </div>
                ) : (
                  messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className="bg-slate-900/50 border border-slate-700/30 rounded-xl p-4 hover:border-indigo-500/30 transition-all duration-200 animate-fade-in"
                      style={{ animationDelay: `${idx * 50}ms` }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <span className="text-sm">👤</span>
                        </div>
                        <div className="flex-1">
                          <div className="text-white break-words">{msg.text}</div>
                          <div className="text-xs text-slate-500 mt-2">
                            {new Date(msg.timestamp * 1000).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* ─────────────────────────────────────────────────────────
              RIGHT COLUMN - SIDEBAR
              ───────────────────────────────────────────────────── */}
          <div className="space-y-6">
            {/* Deposit Manager Component */}
            <DepositManager />

            {/* Info Card */}
            <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-xl">
              <h3 className="text-lg font-bold text-white mb-4">How it Works</h3>
              <div className="space-y-3 text-sm text-slate-300">
                <div className="flex items-start gap-3">
                  <span className="text-lg flex-shrink-0">🔐</span>
                  <div>
                    <div className="font-semibold text-white">Zero-Knowledge Proofs</div>
                    <div className="text-xs text-slate-400 mt-1">Messages are anonymous but verified</div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-lg flex-shrink-0">🔄</span>
                  <div>
                    <div className="font-semibold text-white">Relay System</div>
                    <div className="text-xs text-slate-400 mt-1">Enhanced privacy through relayers</div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-lg flex-shrink-0">⛓️</span>
                  <div>
                    <div className="font-semibold text-white">On-Chain Storage</div>
                    <div className="text-xs text-slate-400 mt-1">All messages stored on Sepolia</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ═══════════════════════════════════════════════════════════════
          CUSTOM SCROLLBAR STYLES
          ═══════════════════════════════════════════════════════════ */}
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(51, 65, 85, 0.3);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(99, 102, 241, 0.5);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(99, 102, 241, 0.7);
        }
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out forwards;
        }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// BOARD WRAPPER WITH SUSPENSE
// ═══════════════════════════════════════════════════════════════════════

/**
 * Board - Wrapper component con Suspense
 *
 * SUSPENSE:
 * Next.js 14 richiede Suspense per componenti che usano:
 * - useRouter() da 'next/navigation'
 * - useSearchParams()
 * - Altri hooks di routing
 *
 * FALLBACK:
 * Mostrato mentre il componente si sta caricando.
 * In pratica non viene quasi mai visto (load molto veloce).
 */
export default function Board() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    }>
      <BoardContent />
    </Suspense>
  );
}

/*
 * ═══════════════════════════════════════════════════════════════════════
 * RIASSUNTO PAGINA BOARD
 * ═══════════════════════════════════════════════════════════════════════
 *
 * SCOPO:
 * Questa pagina implementa la bacheca messaggi con generazione completa
 * di Zero-Knowledge Proofs usando snarkjs e il protocollo Semaphore.
 *
 * FLUSSO UTENTE COMPLETO:
 *
 * 1. MOUNT COMPONENTE:
 *    - Carica identità da localStorage
 *    - Se non trovata → redirect a home
 *    - Avvia syncWithApi() per verificare membership
 *
 * 2. SYNC CON BLOCKCHAIN:
 *    - Polling ogni 5s all'API /api/logs
 *    - Cerca il proprio commitment nella lista membri
 *    - Quando trovato → setIsReady(true)
 *
 * 3. SCRITTURA MESSAGGIO:
 *    - Utente scrive nel textarea
 *    - Seleziona relay fee (default 0.001 ETH)
 *    - Clicca "Post"
 *
 * 4. GENERAZIONE PROOF ZK (handlePost):
 *    a. Carica lista membri dall'API
 *    b. Ricostruisce Group (Merkle tree) localmente
 *    c. Trova indice proprio commitment nel tree
 *    d. Genera Merkle proof (path foglia → root)
 *    e. Calcola signal = keccak256(message) >> 8
 *    f. Carica WASM e ZKEY files
 *    g. Prepara circuit input con nullifier, trapdoor, merkle proof
 *    h. Chiama snarkjs.groth16.fullProve() → 5-15 secondi!
 *    i. Converte proof in formato Solidity (array di 8 uint256)
 *    j. Estrae nullifierHash dai publicSignals
 *
 * 5. CREAZIONE RELAY REQUEST:
 *    - Chiama createRelayRequest(root, nullifierHash, proof, message, fee)
 *    - Utente conferma transaction nel wallet
 *    - Request salvata on-chain (~50k gas)
 *    - Evento RelayRequestCreated emesso
 *
 * 6. RELAY EXECUTION (da altro utente):
 *    - Relayer vede la request
 *    - Chiama executeRelay(requestId)
 *    - Contratto verifica proof (~400k gas)
 *    - Se valida: posta messaggio, paga relayer
 *    - Evento MessagePosted emesso
 *
 * 7. VISUALIZZAZIONE MESSAGGIO:
 *    - Polling ogni 15s a /api/logs
 *    - API legge eventi MessagePosted
 *    - Messaggi appaiono nella board
 *
 * COMPONENTI TECNICI CHIAVE:
 *
 * 1. SEMAPHORE IDENTITY:
 *    - nullifier: BigInt random (segreto)
 *    - trapdoor: BigInt random (segreto)
 *    - commitment: poseidon(nullifier, trapdoor) (pubblico)
 *
 * 2. MERKLE TREE:
 *    - Depth 20 → max 2^20 = 1M membri
 *    - Hash function: Poseidon (ZK-friendly)
 *    - Ogni foglia = identityCommitment di un membro
 *    - Root = hash di tutto l'albero
 *
 * 3. MERKLE PROOF:
 *    - pathIndices: [0|1, 0|1, ...] (left=0, right=1)
 *    - pathElements: [hash, hash, ...] (sibling per ogni livello)
 *    - Permette di provare appartenenza senza rivelare indice
 *
 * 4. ZERO-KNOWLEDGE PROOF:
 *    - Circuito: Semaphore (280k constraints)
 *    - Proof system: Groth16 (efficiente, compatto)
 *    - Input privati: nullifier, trapdoor, merkle path
 *    - Input pubblici: merkleRoot, signal, externalNullifier
 *    - Output: proof (8 uint256) + nullifierHash
 *
 * 5. SIGNAL:
 *    - signal = keccak256(message) >> 8
 *    - Troncato a 254 bit (limiti SNARK field)
 *    - Usato come input pubblico della proof
 *
 * 6. NULLIFIER HASH:
 *    - nullifierHash = poseidon(nullifier, externalNullifier)
 *    - Univoco per (identità, contesto)
 *    - Previene double-signaling
 *    - Non rivela l'identità (hash opaco)
 *
 * 7. RELAY SYSTEM:
 *    - Separa creazione (basso gas) da esecuzione (alto gas)
 *    - Utente crea request (~50k gas)
 *    - Relayer esegue request (~400k gas)
 *    - Relayer riceve fee come incentivo
 *    - Massima privacy: wallet diverso esegue la transaction
 *
 * SICUREZZA:
 *
 * 1. PRIVACY IDENTITÀ:
 *    - Nullifier e trapdoor MAI inviati on-chain
 *    - Solo commitment e nullifierHash pubblici
 *    - Impossibile risalire da nullifierHash a nullifier (hash)
 *    - Impossibile collegare messaggio a identità
 *
 * 2. PREVENZIONE DOUBLE-POSTING:
 *    - nullifierHash tracciato on-chain
 *    - Ogni identità può postare UNA VOLTA per externalNullifier
 *    - Tentativo double-post → transaction revert
 *
 * 3. VERIFICA APPARTENENZA:
 *    - Proof ZK verifica che identità sia nel gruppo
 *    - Merkle root deve matchare on-chain
 *    - Impossibile falsificare appartenenza
 *
 * 4. INTEGRITÀ MESSAGGIO:
 *    - Signal legato crittograficamente alla proof
 *    - Impossibile modificare messaggio dopo proof generation
 *    - Verifier controlla signal nella proof
 *
 * FILES E RISORSE:
 *
 * 1. public/semaphore/semaphore.wasm (~5-10 MB):
 *    - Circuito compilato in WebAssembly
 *    - Generazione witness
 *
 * 2. public/semaphore/semaphore.zkey (~50-100 MB):
 *    - Proving key del circuito
 *    - Parametri per proof generation
 *    - Derivata da trusted setup ceremony
 *
 * 3. localStorage 'ZK_USER_ID':
 *    - Identity serializzata
 *    - Include nullifier e trapdoor
 *    - NON crittografata (solo su device)
 *
 * OTTIMIZZAZIONI:
 *
 * 1. useCallback per funzioni:
 *    - Evita re-creazione a ogni render
 *    - Importante per dependencies di useEffect
 *
 * 2. Polling invece di WebSocket:
 *    - Più semplice e affidabile
 *    - Funziona con qualsiasi RPC provider
 *    - Trade-off: latency vs complessità
 *
 * 3. Caching WASM/ZKEY:
 *    - Browser cacha i file dopo primo download
 *    - Successive proof generation più veloci
 *
 * 4. Group reconstruction locale:
 *    - Evita query costose al contratto
 *    - Merkle tree calcolato client-side
 *
 * PERFORMANCE:
 *
 * TEMPI TIPICI:
 * - Identity load: <100ms
 * - Sync API: 0-30s (dipende da conferma on-chain)
 * - WASM/ZKEY download (first time): 10-30s
 * - Proof generation: 5-15s (dipende da CPU)
 * - Transaction confirm: ~15s (Sepolia block time)
 *
 * GAS COSTS:
 * - createRelayRequest: ~50k gas (~$2-3 su mainnet)
 * - executeRelay: ~400k gas (~$15-20 su mainnet)
 * - TOTALE PER MESSAGGIO: ~450k gas (~$17-23 su mainnet)
 *
 * LIMITAZIONI:
 *
 * 1. CPU-INTENSIVE:
 *    - Proof generation richiede CPU potente
 *    - Su mobile può richiedere 30-60 secondi
 *    - Possibile timeout su device lenti
 *
 * 2. FILE SIZE:
 *    - WASM + ZKEY = ~60-110 MB da scaricare
 *    - Su connessioni lente può richiedere minuti
 *    - Considerate progressive loading
 *
 * 3. NO EDIT/DELETE:
 *    - Messaggi immutabili on-chain
 *    - Impossibile modificare dopo posting
 *    - Solo flagging per moderazione
 *
 * 4. SINGLE EXTERNAL NULLIFIER:
 *    - Ogni identità può postare UNA VOLTA
 *    - Con deposit può postare multipli (ma tracciabile via relay fee)
 *    - Trade-off privacy vs usability
 *
 * FUTURE IMPROVEMENTS:
 *
 * 1. Progressive Proof Generation:
 *    - Mostrare progress bar durante proof generation
 *    - Feedback su % completamento
 *
 * 2. WebWorker per Proof:
 *    - Generare proof in background thread
 *    - UI rimane responsive durante generation
 *
 * 3. Merkle Tree Caching:
 *    - Cachare tree ricostruito in IndexedDB
 *    - Evitare ricostruzione completa ogni volta
 *
 * 4. Batched Messages:
 *    - Permettere multiple proof generation
 *    - Amortizzare costo WASM/ZKEY loading
 *
 * TESTING:
 *
 * Per testare localmente:
 * 1. Registrati sulla home (joinGroupWithDeposit)
 * 2. Aspetta isReady=true (sync completato)
 * 3. Scrivi messaggio e clicca Post
 * 4. Aspetta proof generation (~10s)
 * 5. Conferma transaction nel wallet
 * 6. Vai su /relay e esegui la request
 * 7. Torna su /board, ricarica → messaggio appare!
 */
