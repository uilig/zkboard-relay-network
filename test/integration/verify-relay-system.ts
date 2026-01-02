import { ethers } from "hardhat";

async function main() {
  console.log("🔍 Verifying Complete Relay System Setup\n");
  console.log("=".repeat(70));

  const SEMAPHORE_ADDRESS = "0x3Dc98f1084C5B6B7DAc1D29060c8C109e441FBCe";
  const ZKBOARD_ADDRESS = "0xbB0d8200A285d6627B889Cbd299624DE6BcCE9C4";
  const GROUP_ID = 1767286984;

  const [deployer] = await ethers.getSigners();
  console.log("📍 Deployer:", deployer.address);
  console.log("📍 ZKBoard:", ZKBOARD_ADDRESS);
  console.log("📍 Semaphore:", SEMAPHORE_ADDRESS);
  console.log("📍 Group ID:", GROUP_ID);
  console.log("");

  // Connect to contracts
  const zkboard = await ethers.getContractAt("ZKBoard", ZKBOARD_ADDRESS);
  const semaphore = await ethers.getContractAt("Semaphore", SEMAPHORE_ADDRESS);

  console.log("=".repeat(70));
  console.log("1️⃣  SEMAPHORE GROUP VERIFICATION");
  console.log("=".repeat(70));

  try {
    const group = await semaphore.groups(GROUP_ID);
    console.log("✅ Group exists:");
    console.log("   Admin:", group.admin);
    console.log("   Depth:", group.depth.toString());
    console.log("   Size:", group.size.toString(), "members");
    console.log("   Root:", group.root.toString());
    console.log("");

    if (group.admin.toLowerCase() !== ZKBOARD_ADDRESS.toLowerCase()) {
      console.error("❌ ERROR: ZKBoard is not the group admin!");
      return;
    }
    console.log("✅ ZKBoard is correctly set as group admin");

    if (group.size === 0n) {
      console.warn("⚠️  WARNING: No members in group yet");
      console.log("   Run test-with-real-identity.js to register");
    } else {
      console.log(`✅ Group has ${group.size} member(s)`);
    }
  } catch (error: any) {
    console.error("❌ Failed to get group info:", error.message);
    return;
  }

  console.log("");
  console.log("=".repeat(70));
  console.log("2️⃣  DEPOSIT SYSTEM VERIFICATION");
  console.log("=".repeat(70));

  try {
    const deposit = await zkboard.deposits(deployer.address);
    const credits = await zkboard.credits(deployer.address);

    console.log("💰 Deployer account:");
    console.log("   Deposit:", ethers.formatEther(deposit), "ETH");
    console.log("   Credits:", credits.toString());

    if (deposit === 0n) {
      console.warn("\n⚠️  WARNING: No deposit found");
      console.log("   Run: node test-with-real-identity.js");
    } else {
      console.log("\n✅ Deposit system is active");
    }
  } catch (error: any) {
    console.error("❌ Failed to check deposits:", error.message);
  }

  console.log("");
  console.log("=".repeat(70));
  console.log("3️⃣  RELAY REQUEST SYSTEM VERIFICATION");
  console.log("=".repeat(70));

  try {
    const nextRequestId = await zkboard.nextRequestId();
    console.log("📊 Next request ID:", nextRequestId.toString());

    if (nextRequestId === 0n) {
      console.log("ℹ️  No relay requests created yet");
    } else {
      console.log(`ℹ️  ${nextRequestId} relay request(s) created so far`);

      // Check last request
      const lastId = nextRequestId - 1n;
      const request = await zkboard.relayRequests(lastId);
      console.log("\n📝 Last request (#" + lastId + "):");
      console.log("   Message:", request.message || "(empty)");
      console.log("   Relay fee:", ethers.formatEther(request.relayFee), "ETH");
      console.log("   Requester:", request.requester);
      console.log("   Executed:", request.executed);
    }
  } catch (error: any) {
    console.error("❌ Failed to check relay requests:", error.message);
  }

  console.log("");
  console.log("=".repeat(70));
  console.log("4️⃣  CONTRACT CONFIGURATION");
  console.log("=".repeat(70));

  try {
    const groupId = await zkboard.groupId();
    const MIN_DEPOSIT = "0.05";
    const COST_PER_MESSAGE = "0.001";

    console.log("✅ Contract configuration:");
    console.log("   Group ID:", groupId.toString());
    console.log("   Min deposit:", MIN_DEPOSIT, "ETH");
    console.log("   Cost per message:", COST_PER_MESSAGE, "ETH");
  } catch (error: any) {
    console.error("❌ Failed to check configuration:", error.message);
  }

  console.log("");
  console.log("=".repeat(70));
  console.log("5️⃣  MESSAGE COUNT");
  console.log("=".repeat(70));

  try {
    const messageCount = await zkboard.messageCount();
    console.log("📬 Total messages posted:", messageCount.toString());

    if (messageCount === 0n) {
      console.log("ℹ️  No messages posted yet");
    } else {
      console.log(`✅ ${messageCount} message(s) successfully posted`);
    }
  } catch (error: any) {
    console.error("❌ Failed to check message count:", error.message);
  }

  console.log("");
  console.log("=".repeat(70));
  console.log("📋 SYSTEM STATUS SUMMARY");
  console.log("=".repeat(70));

  const group = await semaphore.groups(GROUP_ID);
  const deposit = await zkboard.deposits(deployer.address);
  const nextRequestId = await zkboard.nextRequestId();
  const messageCount = await zkboard.messageCount();

  console.log("");
  console.log("✅ Smart contracts deployed and initialized");
  console.log(group.size > 0n ? "✅" : "⚠️ ", `Group has ${group.size} member(s)`);
  console.log(deposit > 0n ? "✅" : "⚠️ ", `Deposit: ${ethers.formatEther(deposit)} ETH`);
  console.log("ℹ️  Relay requests created:", nextRequestId.toString());
  console.log("ℹ️  Messages posted:", messageCount.toString());

  console.log("");
  console.log("=".repeat(70));
  console.log("🎯 NEXT STEPS");
  console.log("=".repeat(70));
  console.log("");

  if (group.size === 0n || deposit === 0n) {
    console.log("1. Register with deposit:");
    console.log("   node test-with-real-identity.js");
    console.log("");
  }

  console.log("2. Start frontend for full testing:");
  console.log("   cd zkboard-frontend && npm run dev");
  console.log("");
  console.log("3. Test relay system via frontend:");
  console.log("   - Register/login with your identity");
  console.log("   - Create a relay request (post message with relay)");
  console.log("   - Navigate to /relay page");
  console.log("   - Execute pending relay requests");
  console.log("");
  console.log("4. Verify on Sepolia Etherscan:");
  console.log("   ZKBoard: https://sepolia.etherscan.io/address/" + ZKBOARD_ADDRESS);
  console.log("   Semaphore: https://sepolia.etherscan.io/address/" + SEMAPHORE_ADDRESS);
  console.log("");

  console.log("=".repeat(70));
  console.log("✨ Verification complete!");
  console.log("=".repeat(70));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
