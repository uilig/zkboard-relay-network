/**
 * Simplified Relay System Test on Sepolia
 * Uses API to get members instead of querying events directly
 */

const { ethers } = require("ethers");
const { Identity } = require("@semaphore-protocol/identity");
const { Group } = require("@semaphore-protocol/group");
const snarkjs = require("snarkjs");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

// Configuration
const ZKBOARD_ADDRESS = "0xbB0d8200A285d6627B889Cbd299624DE6BcCE9C4";
const SEMAPHORE_ADDRESS = "0x3Dc98f1084C5B6B7DAc1D29060c8C109e441FBCe";
const GROUP_ID = 1767286984;
const RPC_URL = process.env.SEPOLIA_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const ZKBOARD_ABI = [
  "function joinGroupWithDeposit(uint256 identityCommitment) payable",
  "function createRelayRequest(uint256 merkleTreeRoot, uint256 nullifierHash, uint256[8] calldata proof, string calldata message, uint256 relayFee) external",
  "function executeRelay(uint256 requestId) external",
  "function nextRequestId() view returns (uint256)",
  "function messageCount() view returns (uint256)",
  "function credits(address) view returns (uint256)",
  "event RelayRequestCreated(uint256 requestId, uint256 relayFee, uint256 timestamp)",
  "event MessageRelayed(uint256 requestId, address indexed relayer, uint256 fee)",
  "event MessagePosted(string message, uint256 timestamp)"
];

const SEMAPHORE_ABI = [
  "function groups(uint256) view returns (address admin, uint256 depth, uint256 size, uint256 root)"
];

async function main() {
  console.log("🧪 RELAY SYSTEM TEST ON SEPOLIA\n");
  console.log("=".repeat(70));

  // Setup
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const zkboard = new ethers.Contract(ZKBOARD_ADDRESS, ZKBOARD_ABI, wallet);
  const semaphore = new ethers.Contract(SEMAPHORE_ADDRESS, SEMAPHORE_ABI, provider);

  console.log("📍 Configuration:");
  console.log("   Wallet:", wallet.address);
  console.log("   ZKBoard:", ZKBOARD_ADDRESS);
  console.log("   Group ID:", GROUP_ID);
  console.log("");

  // Step 1: Get group info
  console.log("=".repeat(70));
  console.log("STEP 1: Fetching Group Information");
  console.log("=".repeat(70));

  const groupInfo = await semaphore.groups(GROUP_ID);
  console.log("✅ Group info:");
  console.log("   Size:", groupInfo.size.toString(), "members");
  console.log("   Root:", groupInfo.root.toString());
  console.log("");

  if (groupInfo.size === 0n) {
    console.error("❌ ERROR: No members in group. Run test-with-real-identity.js first");
    process.exit(1);
  }

  // Check credits
  const initialCredits = await zkboard.credits(wallet.address);
  console.log("💰 Credits available:", initialCredits.toString());

  if (initialCredits === 0n) {
    console.error("❌ ERROR: No credits. Deposit required first.");
    process.exit(1);
  }
  console.log("");

  // Step 2: Fetch members from API
  console.log("=".repeat(70));
  console.log("STEP 2: Loading Members from API");
  console.log("=".repeat(70));

  console.log("⏳ Fetching members from http://localhost:3000/api/logs...");

  let members;
  try {
    const response = await fetch("http://localhost:3000/api/logs", { cache: 'no-store' });
    const data = await response.json();

    if (!data.members || !Array.isArray(data.members)) {
      throw new Error("Invalid API response");
    }

    members = data.members.map(m => BigInt(m));
    console.log("✅ Fetched", members.length, "members from API");
  } catch (error) {
    console.error("❌ ERROR: Failed to fetch members from API");
    console.error("   Make sure frontend is running: cd zkboard-frontend && npm run dev");
    console.error("   Error:", error.message);
    process.exit(1);
  }

  if (members.length === 0) {
    console.error("❌ ERROR: No members in group");
    process.exit(1);
  }

  console.log("   First member:", members[0].toString());
  console.log("");

  // Step 3: Use first member identity (we'll use a registered one)
  console.log("=".repeat(70));
  console.log("STEP 3: Preparing Identity");
  console.log("=".repeat(70));

  // For this test, we need to use an identity that's already registered
  // We'll create a new one and register it
  console.log("🔐 Creating new test identity...");
  const identity = new Identity();
  console.log("✅ Identity created");
  console.log("   Commitment:", identity.commitment.toString());
  console.log("");

  const isRegistered = members.some(m => m === identity.commitment);

  if (!isRegistered) {
    console.log("⚠️  Identity not registered. Registering now...");
    const registerTx = await zkboard.joinGroupWithDeposit(identity.commitment, {
      value: ethers.parseEther("0.05"),
      gasLimit: 1000000
    });
    console.log("⏳ Registration TX:", registerTx.hash);
    const registerReceipt = await registerTx.wait();
    console.log("✅ Registered! Block:", registerReceipt.blockNumber);
    console.log("");

    // Add to members
    members.push(identity.commitment);

    // Wait a bit for API to update
    console.log("⏳ Waiting 5 seconds for API to sync...");
    await new Promise(resolve => setTimeout(resolve, 5000));
  } else {
    console.log("✅ Identity already in group");
  }

  // Build local group
  console.log("🌳 Building local Merkle tree...");
  const group = new Group(GROUP_ID, 20);
  console.log("   Created empty group");

  for (const member of members) {
    group.addMember(member);
  }
  console.log("   Added", members.length, "members");

  const memberIndex = group.indexOf(identity.commitment);
  if (memberIndex === -1) {
    console.error("❌ ERROR: Identity not found in local group");
    process.exit(1);
  }

  console.log("✅ Local group built");
  console.log("   Members:", members.length);
  console.log("   Local root:", group.root.toString());
  console.log("   On-chain root:", groupInfo.root.toString());
  console.log("   Member index:", memberIndex);
  console.log("");

  // Step 4: Generate ZK Proof
  console.log("=".repeat(70));
  console.log("STEP 4: Generating ZK Proof");
  console.log("=".repeat(70));

  const testMessage = "🧪 Relay test - " + new Date().toISOString();
  console.log("📝 Message:", testMessage);
  console.log("");

  const messageHash = ethers.keccak256(ethers.toUtf8Bytes(testMessage));
  const signal = BigInt(messageHash) >> BigInt(8);

  const merkleProof = group.generateMerkleProof(memberIndex);

  console.log("⏳ Generating ZK proof (may take 10-30 seconds)...");

  const wasmPath = path.join(__dirname, "zkboard-frontend", "public", "semaphore", "semaphore.wasm");
  const zkeyPath = path.join(__dirname, "zkboard-frontend", "public", "semaphore", "semaphore.zkey");

  const circuitInput = {
    identityNullifier: identity.nullifier.toString(),
    identityTrapdoor: identity.trapdoor.toString(),
    treePathIndices: merkleProof.pathIndices,
    treeSiblings: merkleProof.siblings.map(s => s.toString()),
    signalHash: signal.toString(),
    externalNullifier: GROUP_ID.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput,
    wasmPath,
    zkeyPath
  );

  console.log("✅ ZK Proof generated!");

  const proofArray = [
    proof.pi_a[0],
    proof.pi_a[1],
    proof.pi_b[0][1],
    proof.pi_b[0][0],
    proof.pi_b[1][1],
    proof.pi_b[1][0],
    proof.pi_c[0],
    proof.pi_c[1],
  ];

  const nullifierHash = publicSignals[1];
  console.log("   Nullifier hash:", nullifierHash);
  console.log("");

  // Step 5: Create Relay Request
  console.log("=".repeat(70));
  console.log("STEP 5: Creating Relay Request");
  console.log("=".repeat(70));

  const relayFee = ethers.parseEther("0.001");
  const initialRequestId = await zkboard.nextRequestId();

  console.log("💰 Relay fee:", ethers.formatEther(relayFee), "ETH");
  console.log("📊 Next request ID:", initialRequestId.toString());
  console.log("");

  console.log("⏳ Creating relay request...");
  const createTx = await zkboard.createRelayRequest(
    group.root,
    nullifierHash,
    proofArray,
    testMessage,
    relayFee,
    { gasLimit: 2000000 }
  );

  console.log("✅ TX sent:", createTx.hash);
  const createReceipt = await createTx.wait();
  console.log("✅ Confirmed! Block:", createReceipt.blockNumber);
  console.log("");

  const requestId = initialRequestId;
  const newRequestId = await zkboard.nextRequestId();
  console.log("✅ Request #" + requestId + " created");
  console.log("   New nextRequestId:", newRequestId.toString());
  console.log("");

  // Step 6: Execute Relay
  console.log("=".repeat(70));
  console.log("STEP 6: Executing Relay");
  console.log("=".repeat(70));

  const initialMessageCount = await zkboard.messageCount();
  console.log("📊 Messages before:", initialMessageCount.toString());
  console.log("");

  console.log("⏳ Executing relay...");
  const executeTx = await zkboard.executeRelay(requestId, { gasLimit: 2000000 });
  console.log("✅ TX sent:", executeTx.hash);
  const executeReceipt = await executeTx.wait();
  console.log("✅ Confirmed! Block:", executeReceipt.blockNumber);
  console.log("");

  // Step 7: Verify
  console.log("=".repeat(70));
  console.log("STEP 7: Verifying Results");
  console.log("=".repeat(70));

  const finalMessageCount = await zkboard.messageCount();

  console.log("✅ Results:");
  console.log("   Messages:", initialMessageCount.toString(), "→", finalMessageCount.toString());
  console.log("");

  // Summary
  console.log("=".repeat(70));
  console.log("🎉 TEST COMPLETE");
  console.log("=".repeat(70));
  console.log("");

  const success = finalMessageCount > initialMessageCount;

  if (success) {
    console.log("✅ SUCCESS! Relay system works perfectly!");
    console.log("");
    console.log("📝 Message posted:", testMessage);
    console.log("🔗 Transactions:");
    console.log("   Create: https://sepolia.etherscan.io/tx/" + createTx.hash);
    console.log("   Execute: https://sepolia.etherscan.io/tx/" + executeTx.hash);
    console.log("");
  } else {
    console.error("❌ Test failed - unexpected state");
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Test failed:", error.message);
    console.error(error);
    process.exit(1);
  });
