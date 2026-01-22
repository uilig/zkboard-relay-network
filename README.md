# ZKBoard - Anonymous Decentralized Message Board

An anonymous message board built on Ethereum using Zero-Knowledge Proofs (zk-SNARKs) and the Semaphore protocol. Post messages without revealing your identity, while cryptographically proving you're an authorized member of the group.

## Overview

ZKBoard is a **decentralized public bulletin board** that allows users to post messages anonymously. Unlike traditional anonymous systems (like SecureDrop or GlobaLeaks) that rely on trusted servers, ZKBoard operates entirely on the Ethereum blockchain, providing:

- **Cryptographic anonymity**: ZK proofs hide which identity commitment generated a message
- **Censorship resistance**: Messages are stored immutably on the blockchain
- **Trustless operation**: No central authority can censor or modify messages
- **Sybil resistance**: Economic deposits prevent spam attacks

### What Makes ZKBoard Different

| Feature | Traditional Systems | ZKBoard |
|---------|-------------------|---------|
| Anonymity type | Network-level (Tor) | Cryptographic (zk-SNARKs) |
| Infrastructure | Centralized servers | Decentralized blockchain |
| Censorship resistance | Limited (server shutdown) | Complete (immutable) |
| Trust model | Trust the operator | Trustless (smart contract) |
| Multiple messages | Varies | Supported with unlinkability |
| Anti-spam | None native | Economic deposits |

## Features

- **Anonymous Posting**: Messages are anonymous thanks to ZK-SNARK proofs
- **Dual Posting Mode**: Post directly or use the relay system
- **Deposit-Based System**: Users deposit ETH to get message credits (recoverable)
- **Multi-Message Support**: Same identity can post multiple unlinkable messages
- **On-Chain Storage**: All messages permanently stored on Ethereum Sepolia
- **Modern UI**: Clean, responsive interface built with Next.js and TailwindCSS

## Important Security Limitations

### What ZKBoard Protects

1. **Identity Commitment Privacy**: The ZK proof hides which identity commitment in the Merkle tree generated the message
2. **Message Unlinkability**: Multiple messages from the same identity cannot be correlated (different nullifiers)
3. **Message Integrity**: Messages cannot be modified after publication

### What ZKBoard Does NOT Protect

**Your Ethereum address is visible on-chain.** This is a critical limitation:

- When you register, your address is linked to your identity commitment via the `MemberJoined` event
- When you create a relay request, your address is stored in the `requester` field
- When you post directly, your address is the transaction sender

An observer analyzing the blockchain (not just the board UI) can:
1. See a message timestamp
2. Find the corresponding transaction
3. Identify the Ethereum address that initiated it
4. Potentially link that address to a real identity (via exchange KYC, IP correlation, etc.)

### Adversary Capability Table

| Adversary Level | Capability | Protected by ZKBoard? |
|-----------------|------------|----------------------|
| L1 - Casual | Views the board UI | Yes |
| L2 - On-chain analyst | Analyzes Etherscan/events | **No** |
| L3 - Correlation analyst | Correlates timing/amounts | **No** |
| L4 - Off-chain | Access to exchange/IP data | **No** |

## How to Protect Yourself

To maximize privacy when using ZKBoard, follow these recommendations:

1. **Use a dedicated Ethereum address** - Never use an address connected to your real identity
2. **Fund the address anonymously** - Options include:
   - Cryptocurrency mixers (note: legal restrictions in some jurisdictions)
   - Peer-to-peer exchanges without KYC
   - Receiving ETH for goods/services
   - Cross-chain atomic swaps
3. **Wait before posting** - Don't post immediately after registering (avoids timing correlation)
4. **Vary deposit amounts** - When possible, don't use distinctive amounts
5. **Use VPN or Tor** - When interacting with the frontend (avoids IP correlation)
6. **Never reuse the address** - Don't withdraw to KYC exchanges or use for other activities

## Architecture

### Smart Contracts

- **ZKBoard.sol**: Main contract managing messages, deposits, and relay system
- **Semaphore.sol**: Custom Semaphore implementation with multi-message support
- **SemaphoreVerifier.sol**: Groth16 proof verifier (BN254 curve)

### Frontend

- **Next.js 16**: React-based framework with App Router
- **RainbowKit**: Wallet connection
- **Wagmi + Viem**: Ethereum interactions
- **Semaphore SDK v3**: Zero-knowledge identity and proof generation

## Project Structure

```
├── contracts/           # Solidity smart contracts
│   ├── ZKBoard.sol
│   ├── Semaphore.sol
│   └── SemaphoreVerifier.sol
├── scripts/             # Deployment scripts
│   └── deploy.ts
├── frontend/            # Next.js frontend application
│   ├── app/
│   │   ├── page.tsx           # Home/registration
│   │   ├── board/page.tsx     # Message board
│   │   ├── relay/page.tsx     # Relay dashboard
│   │   ├── api/               # API routes
│   │   └── utils/             # Constants & utilities
│   └── public/
│       └── semaphore/         # ZK circuit files (wasm, zkey)
└── test/                # Contract tests
```

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn
- MetaMask or another Web3 wallet
- Sepolia testnet ETH

### Installation

1. **Clone the repository:**
```bash
git clone https://github.com/yourusername/zkboard.git
cd zkboard
```

2. **Install dependencies:**
```bash
# Root (contracts)
npm install

# Frontend
cd frontend
npm install
```

3. **Set up environment variables:**

Create `.env` in the root directory:
```env
SEPOLIA_PRIVATE_KEY=your_private_key_here
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_API_KEY
```

### Deployment

1. **Deploy contracts to Sepolia:**
```bash
npx hardhat run scripts/deploy.ts --network sepolia
```

2. **Update frontend configuration:**

Edit `frontend/app/utils/constants.ts`:
```typescript
export const ZKBOARD_ADDRESS = "0x..."; // From deployment output
export const FALLBACK_GROUP_ID = 1234567890; // From deployment output
```

3. **Run the frontend:**
```bash
cd frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## How It Works

### 1. Registration

- User connects wallet and generates a Semaphore identity (stored locally in browser)
- Deposits minimum 0.05 ETH (approximately 50 message credits)
- Identity commitment is added to the Semaphore group on-chain

### 2. Posting Messages

**Direct Post:**
- User creates a message and generates ZK proof client-side
- Sends transaction directly to the blockchain
- Simpler, but your address is visible as transaction sender

**Relay Post:**
- User creates a relay request with the ZK proof
- A relayer picks up and executes the request
- Your address is still visible in the relay request data

### 3. Proof Generation

The ZK proof demonstrates:
- You know the secret (nullifier + trapdoor) for an identity in the group
- The message hash is bound to the proof
- The proof uses the current message counter as external nullifier

This allows **multiple messages per identity** while maintaining **unlinkability** between them.

## Gas Costs (Estimated)

| Operation | Gas | Cost (20 gwei, ETH=$3000) |
|-----------|-----|---------------------------|
| Registration | ~150k | ~$9 |
| Relay Request Creation | ~50k | ~$3 |
| Relay Execution | ~400k | ~$24 |
| Direct Post | ~400k | ~$24 |

## Development

### Running Tests

```bash
npx hardhat test
```

### Compile Contracts

```bash
npx hardhat compile
```

### Local Development

```bash
# Start Hardhat node
npx hardhat node

# Deploy to localhost
npx hardhat run scripts/deploy.ts --network localhost

# Run frontend
cd frontend && npm run dev
```

## Key Technologies

- **Semaphore Protocol**: Zero-knowledge group membership proofs
- **Groth16**: Efficient ZK-SNARK proof system
- **Poseidon Hash**: ZK-friendly hash function for Merkle trees
- **snarkjs**: JavaScript library for ZK proof generation
- **Next.js**: React framework for production
- **Hardhat**: Ethereum development environment
- **Viem**: TypeScript Ethereum library

## Future Improvements

The main limitation of ZKBoard is the visibility of Ethereum addresses. A proposed solution is a **ZK Ticket System** similar to Tornado Cash, where:

1. Users deposit ETH into an anonymous pool receiving a secret ticket
2. Relay requests include a ZK proof of ticket ownership instead of a `requester` address
3. This would provide complete address privacy while maintaining trustless operation

## Security Considerations

- **Private Keys**: Never commit `.env` files
- **ZK Proofs**: Generated client-side, secrets never leave the browser
- **Identity Storage**: Stored in localStorage - clearing browser data loses your identity
- **Smart Contracts**: Follow CEI pattern, reentrancy protection included

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [Semaphore Protocol](https://semaphore.pse.dev/) by Privacy & Scaling Explorations
- [ZK-Kit](https://github.com/privacy-scaling-explorations/zk-kit) libraries
- [Hardhat](https://hardhat.org/) development environment
- [RainbowKit](https://www.rainbowkit.com/) wallet connection

## References

- Semaphore Protocol Documentation
- "Blockchain is Watching You" - Victor and Weintraud (Address deanonymization)
- "Deanonymisation attacks on Tor" - Biryukov and Tikhomirov

---

**Note**: This is a research/educational project. While it provides cryptographic anonymity guarantees, blockchain address privacy requires additional measures as described above.
