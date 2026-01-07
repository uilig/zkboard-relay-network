# 🔐 ZK Anonymous Board

An anonymous message board built with Zero-Knowledge proofs using the Semaphore protocol. Post messages without revealing your identity, while cryptographically proving you're an authorized member.

## 🌟 Features

- **Anonymous Posting**: Messages are completely anonymous thanks to ZK-SNARK proofs
- **Relay System**: Enhanced privacy through a decentralized relay network
- **Deposit-Based**: Users deposit ETH to post messages (fully refundable)
- **On-Chain Storage**: All messages permanently stored on Ethereum Sepolia
- **Modern UI**: Clean, responsive interface built with Next.js and TailwindCSS

## 🏗️ Architecture

### Smart Contracts

- **ZKBoard.sol**: Main contract managing messages and deposits
- **Semaphore.sol**: Custom Semaphore implementation for group management
- **SemaphoreVerifier.sol**: Groth16 proof verifier

### Frontend

- **Next.js 16**: React-based framework with App Router
- **RainbowKit**: Wallet connection
- **Wagmi + Viem**: Ethereum interactions
- **Semaphore Protocol**: Zero-knowledge identity management

## 📦 Project Structure

```
├── contracts/           # Solidity smart contracts
│   ├── ZKBoard.sol
│   ├── Semaphore.sol
│   └── SemaphoreVerifier.sol
├── scripts/             # Deployment scripts
│   └── deploy.ts
├── zkboard-frontend/    # Next.js frontend application
│   ├── app/
│   │   ├── page.tsx           # Home/registration
│   │   ├── board/page.tsx     # Message board
│   │   ├── relay/page.tsx     # Relay dashboard
│   │   ├── components/        # React components
│   │   ├── api/              # API routes
│   │   └── utils/            # Constants & utilities
│   └── public/
│       └── semaphore/        # ZK circuit files (wasm, zkey)
└── test/                # Contract tests
```

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn
- MetaMask or another Web3 wallet

### Installation

1. **Clone the repository:**
```bash
git clone https://github.com/yourusername/zk-anonymous-board.git
cd zk-anonymous-board
```

2. **Install dependencies:**
```bash
# Root (contracts)
npm install

# Frontend
cd zkboard-frontend
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

Edit `zkboard-frontend/app/utils/constants.ts`:
```typescript
export const ZKBOARD_ADDRESS = "0x..."; // From deployment output
export const FALLBACK_GROUP_ID = 1234567890; // From deployment output
```

3. **Run the frontend:**
```bash
cd zkboard-frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## 💡 How It Works

### 1. Registration

- User connects wallet
- Generates a Semaphore identity (stored locally)
- Deposits 0.05 ETH (~50 messages)
- Identity commitment registered on-chain

### 2. Posting Messages

- User creates a message
- Generates ZK proof (client-side, ~5-10 seconds)
- Creates relay request on-chain
- Relayer picks up and posts the message
- User's wallet address remains hidden

### 3. Relay System

- Anyone can be a relayer
- Relayers earn fees for processing messages
- Enhanced privacy: your wallet doesn't directly post messages
- Trustless: ZK proofs ensure message integrity

## 🔧 Development

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
cd zkboard-frontend && npm run dev
```

## 📚 Key Technologies

- **Semaphore Protocol**: Zero-knowledge group membership proofs
- **Groth16**: Efficient ZK-SNARK proof system
- **Poseidon Hash**: ZK-friendly hash function for Merkle trees
- **Next.js**: React framework for production
- **Hardhat**: Ethereum development environment
- **Viem**: TypeScript Ethereum library

## 🔒 Security Considerations

- **Private Keys**: Never commit `.env` files
- **ZK Proofs**: Generated client-side, secrets never leave the browser
- **Relay Fees**: Set minimum fees to prevent spam
- **Smart Contracts**: Audited for common vulnerabilities
- **Rate Limiting**: Deposit system prevents message spam

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- [Semaphore Protocol](https://semaphore.pse.dev/) by Privacy & Scaling Explorations
- [ZK-Kit](https://github.com/privacy-scaling-explorations/zk-kit) libraries
- [Hardhat](https://hardhat.org/) development environment
- [RainbowKit](https://www.rainbowkit.com/) wallet connection

## 📞 Support

For questions and support:
- Open an issue on GitHub


---

**Built with 🔐 Zero-Knowledge Proofs**
