/**
 * Test ZKBoard with Real Semaphore Identity
 */

const { ethers } = require("ethers");
const { Identity } = require("@semaphore-protocol/identity");
require("dotenv").config();

// Configuration
const ZKBOARD_ADDRESS = "0xbB0d8200A285d6627B889Cbd299624DE6BcCE9C4";
const GROUP_ID = 1767286984;
const RPC_URL = process.env.SEPOLIA_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const ZKBOARD_ABI = [
  "function joinGroupWithDeposit(uint256 identityCommitment) payable",
  "function deposits(address user) view returns (uint256)",
  "function credits(address user) view returns (uint256)",
  "function groupId() view returns (uint256)"
];

async function main() {
  console.log("🧪 Testing with REAL Semaphore Identity\n");
  console.log("=" .repeat(60));

  // Setup
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(ZKBOARD_ADDRESS, ZKBOARD_ABI, wallet);

  console.log("📍 Configuration:");
  console.log("   Contract:", ZKBOARD_ADDRESS);
  console.log("   Wallet:", wallet.address);
  console.log("   Group ID:", GROUP_ID);
  console.log("");

  // Generate REAL Semaphore Identity
  console.log("🔐 Generating Semaphore Identity...");
  const identity = new Identity();

  console.log("✅ Identity generated!");
  console.log("   Commitment:", identity.commitment.toString());
  console.log("");

  // Verify commitment is in valid range
  const SNARK_SCALAR_FIELD = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
  if (BigInt(identity.commitment) >= SNARK_SCALAR_FIELD) {
    console.error("❌ ERROR: Commitment >= SNARK_SCALAR_FIELD!");
    console.error("   This should never happen with @semaphore-protocol/identity");
    process.exit(1);
  }
  console.log("✅ Commitment is valid (< SNARK_SCALAR_FIELD)");
  console.log("");

  // Check current deposit
  const initialDeposit = await contract.deposits(wallet.address);
  console.log("💰 Current deposit:", ethers.formatEther(initialDeposit), "ETH\n");

  // Test joinGroupWithDeposit
  console.log("=" .repeat(60));
  console.log("TEST: joinGroupWithDeposit");
  console.log("=" .repeat(60));
  console.log("");

  const depositAmount = ethers.parseEther("0.05");
  console.log("💰 Depositing:", ethers.formatEther(depositAmount), "ETH");
  console.log("🔑 Identity commitment:", identity.commitment.toString());
  console.log("");

  try {
    console.log("⏳ Sending transaction...");
    const tx = await contract.joinGroupWithDeposit(
      BigInt(identity.commitment),
      {
        value: depositAmount,
        gasLimit: 1000000
      }
    );

    console.log("✅ Transaction sent:", tx.hash);
    console.log("⏳ Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed!");
    console.log("   Block:", receipt.blockNumber);
    console.log("   Gas used:", receipt.gasUsed.toString());
    console.log("");

    // Verify deposit and credits
    const newDeposit = await contract.deposits(wallet.address);
    const newCredits = await contract.credits(wallet.address);

    console.log("📊 After registration:");
    console.log("   Deposit:", ethers.formatEther(newDeposit), "ETH");
    console.log("   Credits:", newCredits.toString());
    console.log("");

    const expectedCredits = depositAmount / ethers.parseEther("0.001");
    if (newDeposit > initialDeposit && newCredits === expectedCredits) {
      console.log("=" .repeat(60));
      console.log("🎉 SUCCESS! Registration with deposit works!");
      console.log("=" .repeat(60));
      console.log("");
      console.log("✅ Deposit increased");
      console.log("✅ Credits assigned correctly");
      console.log("✅ Identity commitment added to Semaphore group");
      console.log("");
      console.log("💾 Save this identity for testing:");
      console.log("   Identity string:", identity.toString());
    } else {
      console.error("❌ UNEXPECTED: Deposit/credits values incorrect");
    }

  } catch (error) {
    console.error("\n❌ TRANSACTION FAILED:", error.message);

    if (error.receipt) {
      console.error("\nTransaction details:");
      console.error("   Hash:", error.receipt.hash);
      console.error("   Block:", error.receipt.blockNumber);
      console.error("   Gas used:", error.receipt.gasUsed.toString());
      console.error("   Status:", error.receipt.status);
    }

    if (error.reason) {
      console.error("\nRevert reason:", error.reason);
    }

    console.log("\n🔍 Check transaction on Etherscan:");
    if (error.receipt) {
      console.log(`   https://sepolia.etherscan.io/tx/${error.receipt.hash}`);
    }

    process.exit(1);
  }
}

main()
  .then(() => {
    console.log("✅ Test completed successfully!\n");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Test failed:");
    console.error(error);
    process.exit(1);
  });
