import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

// Controllo di sicurezza: se mancano le chiavi, avvisiamo subito
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

const config: HardhatUserConfig = {
  solidity: "0.8.23",
  networks: {
    // La rete di test pubblica
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    // La rete locale (per i test che abbiamo fatto prima)
    hardhat: {
      chainId: 1337,
    },
  },
};

export default config;
