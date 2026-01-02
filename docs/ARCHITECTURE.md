# 🏗️ ZK Anonymous Board - Technical Architecture

## 📐 System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER BROWSER                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Wallet     │  │  Semaphore   │  │  ZK Circuit  │          │
│  │  (MetaMask)  │  │   Identity   │  │ (wasm+zkey)  │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                  │                   │
│         └─────────────────┼──────────────────┘                   │
│                           │                                      │
│  ┌────────────────────────▼────────────────────────┐            │
│  │         Next.js Frontend Application             │            │
│  │  ┌──────────┐ ┌───────────┐ ┌──────────────┐   │            │
│  │  │  Home    │ │   Board   │ │    Relay     │   │            │
│  │  │  Page    │ │   Page    │ │  Dashboard   │   │            │
│  │  └──────────┘ └───────────┘ └──────────────┘   │            │
│  │                                                  │            │
│  │  ┌──────────────────────────────────────────┐  │            │
│  │  │     Wagmi + Viem (Web3 Library)          │  │            │
│  │  └─────────────────┬────────────────────────┘  │            │
│  └────────────────────┼───────────────────────────┘            │
└────────────────────────┼────────────────────────────────────────┘
                         │
                         │ RPC Calls (HTTP/WebSocket)
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                  ETHEREUM SEPOLIA NETWORK                        │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │              Smart Contracts Layer                      │    │
│  │                                                          │    │
│  │  ┌──────────────────┐         ┌──────────────────┐     │    │
│  │  │   ZKBoard.sol    │◄────────┤  Semaphore.sol   │     │    │
│  │  │                  │         │                  │     │    │
│  │  │ - Deposits       │         │ - Groups         │     │    │
│  │  │ - Relay Requests │         │ - Merkle Trees   │     │    │
│  │  │ - Messages       │         │ - verifyProof()  │     │    │
│  │  │ - Flagging       │         │                  │     │    │
│  │  └──────────────────┘         └────────┬─────────┘     │    │
│  │                                        │               │    │
│  │                          ┌─────────────▼──────────┐    │    │
│  │                          │ SemaphoreVerifier.sol  │    │    │
│  │                          │  (Groth16 Verifier)    │    │    │
│  │                          └────────────────────────┘    │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Events: MemberJoined, MessagePosted, RelayRequestCreated, ... │
└──────────────────────────────────────────────────────────────────┘
                         │
                         │ Event Logs
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                     Frontend API Layer                           │
│  ┌────────────────┐              ┌────────────────┐            │
│  │  /api/logs     │              │ /api/relay-    │            │
│  │                │              │  request       │            │
│  │ Fetches:       │              │                │            │
│  │ - Members      │              │ Load request   │            │
│  │ - Messages     │              │ details by ID  │            │
│  └────────────────┘              └────────────────┘            │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🔗 Component Interaction Flows

### 1. User Registration Flow

```
┌─────────┐
│  User   │
└────┬────┘
     │ 1. Connect Wallet
     ▼
┌─────────────────┐
│  RainbowKit     │
└────┬────────────┘
     │ 2. Wallet Connected (address)
     ▼
┌──────────────────────┐
│ Frontend (Home Page) │
└────┬─────────────────┘
     │ 3. Generate Identity
     ▼
┌─────────────────────────┐
│ @semaphore/identity     │
│ new Identity()          │
│  ├─ random nullifier    │
│  ├─ random trapdoor     │
│  └─ calc commitment     │
└────┬────────────────────┘
     │ 4. Save to localStorage
     │    key: "ZK_USER_ID"
     ▼
┌──────────────────────────┐
│ User approves tx         │
│ (MetaMask popup)         │
└────┬─────────────────────┘
     │ 5. Send transaction
     ▼
┌─────────────────────────────────────┐
│ Smart Contract: joinGroupWithDeposit│
│ (commitment, {value: 0.05 ETH})     │
└────┬────────────────────────────────┘
     │ 6. Execute
     ▼
┌────────────────────────────────────┐
│ Semaphore.addMember()              │
│  └─ Insert commitment in Merkle    │
│     tree @ next available index    │
└────┬───────────────────────────────┘
     │ 7. Update state
     ▼
┌──────────────────────────────────────┐
│ ZKBoard state changes:               │
│ - deposits[userWallet] = 0.05 ETH    │
│ - credits[userWallet] = 50           │
│ - emit MemberJoined(commitment)      │
└────┬─────────────────────────────────┘
     │ 8. Transaction confirmed
     ▼
┌──────────────────────┐
│ Frontend redirects   │
│ to /board            │
└──────────────────────┘
```

### 2. Message Posting Flow (With Relay)

```
┌─────────┐
│  User   │
└────┬────┘
     │ 1. Type message + set relay fee
     ▼
┌──────────────────────┐
│ Frontend (Board)     │
│ - Load identity      │
│ - Fetch all members  │
└────┬─────────────────┘
     │ 2. Build local Merkle tree
     ▼
┌────────────────────────────┐
│ @semaphore/group           │
│ - Add all members          │
│ - Find user's index        │
│ - Generate Merkle proof    │
│   (siblings, indices)      │
└────┬───────────────────────┘
     │ 3. Prepare circuit input
     ▼
┌───────────────────────────────────┐
│ Circuit Input:                    │
│ {                                 │
│   identityNullifier,              │
│   identityTrapdoor,               │
│   treePathIndices: [0,1,0,...]   │
│   treeSiblings: [hash1,hash2,...] │
│   signalHash: keccak(message)     │
│   externalNullifier: groupId      │
│ }                                 │
└────┬──────────────────────────────┘
     │ 4. Load circuit files
     ▼
┌─────────────────────────────┐
│ Fetch from /public:         │
│ - semaphore.wasm (1.2 MB)   │
│ - semaphore.zkey (3.2 MB)   │
└────┬────────────────────────┘
     │ 5. Generate proof (~5-10s)
     ▼
┌──────────────────────────────────┐
│ snarkjs.groth16.fullProve()      │
│                                  │
│ Returns:                         │
│ - proof: { pi_a, pi_b, pi_c }    │
│ - publicSignals: [root, nullH]  │
└────┬─────────────────────────────┘
     │ 6. Format proof for contract
     ▼
┌────────────────────────────────┐
│ proofArray = [                 │
│   proof.pi_a[0],               │
│   proof.pi_a[1],               │
│   proof.pi_b[0][1],            │
│   proof.pi_b[0][0],            │
│   proof.pi_b[1][1],            │
│   proof.pi_b[1][0],            │
│   proof.pi_c[0],               │
│   proof.pi_c[1]                │
│ ]                              │
└────┬───────────────────────────┘
     │ 7. User approves tx
     ▼
┌─────────────────────────────────────┐
│ Smart Contract: createRelayRequest  │
│ (root, nullifierHash,               │
│  proofArray, message, relayFee)     │
└────┬────────────────────────────────┘
     │ 8. Store request
     ▼
┌───────────────────────────────────┐
│ relayRequests[nextRequestId++] = {│
│   merkleTreeRoot,                 │
│   nullifierHash,                  │
│   proof,                          │
│   message,                        │
│   relayFee,                       │
│   requester: msg.sender,          │
│   executed: false                 │
│ }                                 │
│                                   │
│ credits[msg.sender]--             │
│ emit RelayRequestCreated(id, fee) │
└────┬──────────────────────────────┘
     │ 9. Wait for relayer...
     ▼
┌────────────────────┐
│ Message in queue   │
│ (waiting for relay)│
└────────────────────┘
```

### 3. Relay Execution Flow

```
┌──────────┐
│ Relayer  │ (Can be anyone!)
└────┬─────┘
     │ 1. Watch event: RelayRequestCreated
     ▼
┌───────────────────────────────┐
│ Relayer Dashboard (/relay)    │
│ - Display pending requests    │
│ - Sort by fee (highest first) │
└────┬──────────────────────────┘
     │ 2. Select request
     ▼
┌──────────────────────────────┐
│ Click "Relay" button         │
└────┬─────────────────────────┘
     │ 3. Send transaction
     ▼
┌────────────────────────────────┐
│ Smart Contract: executeRelay   │
│ (requestId)                    │
└────┬───────────────────────────┘
     │ 4. Load request data
     ▼
┌──────────────────────────────────┐
│ req = relayRequests[requestId]   │
│                                  │
│ Validations:                     │
│ - !req.executed                  │
│ - !nullifierHashes[req.nullH]    │
└────┬─────────────────────────────┘
     │ 5. Verify ZK Proof
     ▼
┌─────────────────────────────────────┐
│ Semaphore.verifyProof(              │
│   req.merkleTreeRoot,               │
│   req.nullifierHash,                │
│   keccak(req.message) >> 8,         │
│   groupId,                          │
│   req.proof                         │
│ )                                   │
└────┬────────────────────────────────┘
     │ 6. Proof verification
     ▼
┌──────────────────────────────────┐
│ SemaphoreVerifier.verifyProof()  │
│                                  │
│ Groth16 pairing check:           │
│ e(A, B) = e(α, β) · e(C, γ) ·... │
│                                  │
│ Returns: true/false              │
└────┬─────────────────────────────┘
     │ 7. If valid:
     ▼
┌──────────────────────────────────┐
│ State changes:                   │
│ - req.executed = true            │
│ - nullifierHashes[nullH] = true  │
│ - deposits[requester] -= fee     │
│ - transfer(relayer, fee)         │
│                                  │
│ Events:                          │
│ - emit MessagePosted(msg, time)  │
│ - emit MessageRelayed(id, relayer)│
└────┬─────────────────────────────┘
     │ 8. Transaction confirmed
     ▼
┌────────────────────────┐
│ Relayer receives fee   │
│ Message now visible!   │
└────────────────────────┘
```

---

## 🗄️ Data Structures

### Smart Contract State

```solidity
// ZKBoard.sol

contract ZKBoard {
    // Semaphore reference
    ISemaphore public semaphore;
    uint256 public groupId;

    // User deposits and credits
    mapping(address => uint256) public deposits;
    mapping(address => uint256) public credits;

    // Relay requests
    struct RelayRequest {
        uint256 merkleTreeRoot;
        uint256 nullifierHash;
        uint256[8] proof;
        string message;
        uint256 relayFee;
        address requester;
        bool executed;
    }
    mapping(uint256 => RelayRequest) public relayRequests;
    uint256 public nextRequestId;

    // Message flagging
    mapping(bytes32 => uint256) public flagCounts;
    mapping(bytes32 => mapping(address => bool)) public hasUserFlagged;
    uint256 public constant MIN_FLAGS_TO_HIDE = 3;

    // Message tracking
    uint256 public messageCount;

    // Constants
    uint256 public constant MIN_DEPOSIT = 0.05 ether;
    uint256 public constant COST_PER_MESSAGE = 0.001 ether;
}
```

```solidity
// Semaphore.sol

contract Semaphore {
    struct Group {
        address admin;
        uint256 merkleTreeDuration;
        mapping(uint256 => uint256) merkleRootCreationDates;
        mapping(uint256 => bool) members;
    }

    mapping(uint256 => Group) public groups;

    // Merkle tree state per group
    mapping(uint256 => uint256) public roots;       // groupId => current root
    mapping(uint256 => uint256) public depths;      // groupId => tree depth
    mapping(uint256 => uint256) public nextIndices; // groupId => next available index

    // Valid roots (for proof verification)
    mapping(uint256 => mapping(uint256 => bool)) public rootHistory;

    // Used nullifiers (prevent double-signaling)
    mapping(uint256 => bool) public nullifierHashes;
}
```

### Frontend State (React)

```typescript
// Board Page State

interface BoardState {
  // User
  identity: Identity | null;
  isReady: boolean;

  // Messages
  messages: Message[];

  // Posting
  message: string;
  relayFee: string;
  postingStep: 'idle' | 'generating_proof' |
                'awaiting_signature' |
                'request_submitted' | 'success';

  // Transactions
  hash: `0x${string}` | undefined;
}

interface Message {
  text: string;
  timestamp: number;
}
```

```typescript
// Relay Dashboard State

interface RelayState {
  requests: RelayRequest[];
  relayedCount: number;

  // Transaction
  relayHash: `0x${string}` | undefined;
  isPending: boolean;
}

interface RelayRequest {
  id: number;
  message: string;
  relayFee: bigint;
  requester: string;
  executed: boolean;
}
```

### LocalStorage Schema

```json
{
  "ZK_USER_ID": "0x1234...abcd" // Serialized Semaphore Identity
}
```

**Identity Format:**
```javascript
// When parsed:
{
  _nullifier: "12345678901234567890",
  _trapdoor: "98765432109876543210",
  // Commitment calculated on-demand
}
```

---

## 🔐 Cryptographic Components

### 1. Semaphore Identity

```
Generation (Client-Side):
┌────────────────────────────┐
│ Random Number Generator    │
│ (crypto.randomBytes)       │
└──────┬─────────────────────┘
       │
       ├─► nullifier (256 bits)
       └─► trapdoor  (256 bits)
              │
              ▼
       ┌──────────────────┐
       │ Poseidon Hash    │
       │ commitment =     │
       │ hash(nullifier,  │
       │      trapdoor)   │
       └──────────────────┘
```

**Properties:**
- Nullifier: Secret, never revealed
- Trapdoor: Secret, never revealed
- Commitment: Public, stored on-chain

### 2. Merkle Tree (Poseidon Hash)

```
Tree Depth: 20 (supports 2^20 = 1,048,576 members)
Hash Function: Poseidon (ZK-friendly)

Structure:
                    ROOT
                   /    \
                  /      \
                 /        \
              H1            H2
             /  \          /  \
           H3    H4      H5    H6
          / \   / \     / \   / \
        L1 L2 L3 L4  L5 L6 L7 L8
        |  |  |  |   |  |  |  |
      C1 C2 C3 C4 C5 C6 C7 C8  ← Commitments

Merkle Proof for L3:
- siblings: [L4, H3, H2]
- indices: [0, 1, 0]  (left/right path)
```

**Incremental Updates:**
When new member joins:
1. Insert commitment at `nextIndex`
2. Recalculate path from leaf to root
3. Update only affected nodes (~20 hashes)
4. Store new root as valid

### 3. ZK-SNARK Circuit (Groth16)

```
Circuit: Semaphore Signal
Purpose: Prove group membership without revealing identity

Private Inputs:
- identityNullifier
- identityTrapdoor
- treePathIndices[20]
- treeSiblings[20]

Public Inputs:
- merkleTreeRoot
- nullifierHash
- signalHash (message hash)
- externalNullifier (groupId)

Constraints (~15,000):
1. commitment = Poseidon(nullifier, trapdoor)
2. Verify Merkle path from commitment to root
3. nullifierHash = Poseidon(nullifier, externalNullifier)
4. signalHash matches provided signal

Output Proof:
- pi_a: [2 field elements]
- pi_b: [2x2 field elements]
- pi_c: [2 field elements]
Total: 8 x 256-bit numbers
```

**Verification (On-Chain):**
```solidity
function verifyProof(
    uint[2] memory a,
    uint[2][2] memory b,
    uint[2] memory c,
    uint[4] memory input
) public view returns (bool) {
    // Groth16 pairing check
    // e(A, B) = e(α, β) · e(C, γ) · e(public_inputs, δ)
}
```

---

## 📡 Event System

### Emitted Events

```solidity
// User joins
event MemberJoined(uint256 indexed identityCommitment);

// Relay request created
event RelayRequestCreated(
    uint256 requestId,
    uint256 relayFee,
    uint256 timestamp
);

// Message posted (after relay)
event MessagePosted(
    string message,
    uint256 timestamp
);

// Relay executed
event MessageRelayed(
    uint256 requestId,
    address indexed relayer,
    uint256 fee
);

// Deposit topped up
event DepositToppedUp(
    address indexed user,
    uint256 amount,
    uint256 newCredits
);

// Message flagged
event MessageFlagged(
    bytes32 indexed contentHash,
    address indexed flagger,
    uint256 newFlagCount
);
```

### Event Consumption

**Frontend API (`/api/logs`):**
```typescript
// Scan blockchain for events
const memberLogs = await client.getLogs({
  address: ZKBOARD_ADDRESS,
  event: parseAbiItem('event MemberJoined(uint256)'),
  fromBlock: startBlock,
  toBlock: endBlock
});

const messageLogs = await client.getLogs({
  address: ZKBOARD_ADDRESS,
  event: parseAbiItem('event MessagePosted(string, uint256)'),
  fromBlock: startBlock,
  toBlock: endBlock
});

// Process and return
return {
  members: memberLogs.map(log => log.args[0]),
  messages: messageLogs.map(log => ({
    text: log.args[0],
    timestamp: log.args[1]
  }))
};
```

---

## 🔄 Sync & Consistency

### Frontend Sync Strategy

```
┌─────────────────┐
│ Page Load       │
└────┬────────────┘
     │
     ├─► Initial fetch: /api/logs
     │   ├─► Get all members
     │   ├─► Get all messages
     │   └─► Build local state
     │
     ├─► Setup interval: 15 seconds
     │   └─► Refetch /api/logs
     │
     └─► Setup event watchers (Wagmi)
         ├─► watchContractEvent('RelayRequestCreated')
         └─► Auto-refetch on new events
```

### State Synchronization

**Problem:** Local Merkle tree vs On-chain Merkle tree

**Solution:**
1. **Fetch all members** from events
2. **Sort by transaction order** (block number, tx index)
3. **Rebuild tree** in same order locally
4. **Generate proof** using local tree
5. **Submit root** from local tree
6. **Contract verifies** root is in rootHistory

**Consistency Check:**
```javascript
// Before posting
const localRoot = group.root.toString();
const onChainRoot = await contract.getRoot(groupId);

if (localRoot !== onChainRoot) {
  console.warn('Root mismatch - refetching members');
  await syncWithApi();
}
```

---

## 🚀 Performance Optimizations

### Gas Optimization

1. **Batch Operations**: RelayRequests stored, not executed immediately
2. **Minimal Storage**: Only store hashes, not full messages on some paths
3. **Efficient Proofs**: Groth16 (constant size, ~280k gas)
4. **Bitmap Flags**: Consider using for flagging system

### Frontend Optimization

1. **Code Splitting**: Lazy load ZK circuit files
2. **Memoization**: Cache Merkle proofs
3. **Virtual Scrolling**: For large message lists
4. **Web Workers**: ZK proof generation in background thread
5. **Service Worker**: Cache circuit files (wasm, zkey)

### API Optimization

1. **Chunked Scanning**: Scan blockchain in 45k block chunks
2. **Parallel Requests**: Multiple getLogs() calls simultaneously
3. **Caching**: Consider Redis for frequently accessed data
4. **Pagination**: Limit initial message load

---

**Last Updated**: December 31, 2025
**Version**: 2.0.0-beta
