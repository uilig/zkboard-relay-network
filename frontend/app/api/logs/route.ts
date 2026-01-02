import { createPublicClient, http, parseAbiItem } from 'viem';
import { sepolia } from 'viem/chains';
import { NextResponse } from 'next/server';
import { ZKBOARD_ADDRESS } from '../../utils/constants';

// Configurazione Client
const client = createPublicClient({
  chain: sepolia,
  transport: http('https://ethereum-sepolia.publicnode.com'), 
});

// Limite imposto dal nodo pubblico (mettiamo 45.000 per stare sicuri sotto i 50.000)
const CHUNK_SIZE = 45000n;

// Quanto indietro cerchiamo? (500.000 blocchi = circa 2 mesi di storico)
// Questo troverà sicuramente il tuo ID registrato giorni fa.
const TOTAL_SEARCH_RANGE = 500000n; 

export async function GET() {
  try {
    const latestBlock = await client.getBlockNumber();

    // Calcoliamo il punto di partenza (circa 2 mesi fa)
    const startBlock = latestBlock > TOTAL_SEARCH_RANGE ? latestBlock - TOTAL_SEARCH_RANGE : 0n;

    console.log(`API: Inizio scansione paginata dal blocco ${startBlock} al ${latestBlock}...`);

    let allMembers: string[] = [];
    let allMessages: Array<{text: string, timestamp: number}> = [];
    let currentFromBlock = startBlock;

    // --- CICLO DI PAGINAZIONE (CHUNKING) ---
    // Questo è il cuore della soluzione ingegneristica:
    // Spezziamo la richiesta gigante in tante piccole richieste accettabili.
    while (currentFromBlock < latestBlock) {
      // Calcoliamo la fine del chunk corrente
      let currentToBlock = currentFromBlock + CHUNK_SIZE;
      if (currentToBlock > latestBlock) {
        currentToBlock = latestBlock;
      }

      // Richiesta 1: Eventi MemberJoined
      const memberLogs = await client.getLogs({
        address: ZKBOARD_ADDRESS,
        event: parseAbiItem('event MemberJoined(uint256 identityCommitment)'),
        fromBlock: currentFromBlock,
        toBlock: currentToBlock
      });

      // Richiesta 2: Eventi MessagePosted (firma corretta con tutti i parametri)
      const messageLogs = await client.getLogs({
        address: ZKBOARD_ADDRESS,
        event: parseAbiItem('event MessagePosted(bytes32 indexed contentHash, string message, uint256 timestamp, uint256 messageId)'),
        fromBlock: currentFromBlock,
        toBlock: currentToBlock
      });

      // Aggiungiamo i membri
      const chunkMembers = memberLogs.map(log => log.args.identityCommitment?.toString() || "");
      allMembers = [...allMembers, ...chunkMembers];

      // Aggiungiamo i messaggi con tutti i campi disponibili
      const chunkMessages = messageLogs.map(log => ({
        text: log.args.message || "",
        timestamp: Number(log.args.timestamp || 0),
        messageId: Number(log.args.messageId || 0),
        contentHash: log.args.contentHash || ""
      }));

      allMessages = [...allMessages, ...chunkMessages];

      // Prepariamo il prossimo passo
      currentFromBlock = currentToBlock + 1n;
    }

    // IMPORTANTE: Teniamo DUE array:
    // 1. members: tutti i membri inclusi duplicati (per Merkle tree matching on-chain)
    // 2. uniqueMembers: membri unici (per conteggio)
    const members = allMembers.filter(m => m !== "");
    const uniqueMembers = [...new Set(allMembers)].filter(m => m !== "");

    // Ordiniamo i messaggi per timestamp (più recenti prima)
    const sortedMessages = allMessages
      .filter(m => m.text !== "")
      .sort((a, b) => b.timestamp - a.timestamp);

    console.log(`API: Scansione completata. Trovati ${uniqueMembers.length} membri unici (${members.length} totali con duplicati) e ${sortedMessages.length} messaggi.`);

    return NextResponse.json({
      success: true,
      count: uniqueMembers.length,
      members: members, // Tutti i membri inclusi duplicati per Merkle tree
      messages: sortedMessages
    });

  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({
      success: false,
      error: "Errore durante la paginazione: " + error.message
    }, { status: 500 });
  }
}
