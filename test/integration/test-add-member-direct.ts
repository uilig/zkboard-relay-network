import { ethers } from "hardhat";

async function main() {
  console.log("🧪 Testing addMember directly to Semaphore\n");

  const SEMAPHORE_ADDRESS = "0x3Dc98f1084C5B6B7DAc1D29060c8C109e441FBCe";
  const ZKBOARD_ADDRESS = "0xbB0d8200A285d6627B889Cbd299624DE6BcCE9C4";
  const GROUP_ID = 1767286984;

  const [deployer] = await ethers.getSigners();
  console.log("Caller:", deployer.address);
  console.log("Semaphore:", SEMAPHORE_ADDRESS);
  console.log("ZKBoard:", ZKBOARD_ADDRESS);
  console.log("Group ID:", GROUP_ID);
  console.log("");

  const semaphore = await ethers.getContractAt("Semaphore", SEMAPHORE_ADDRESS);

  // Check group info
  console.log("📊 Checking group info...");
  try {
    const group = await semaphore.groups(GROUP_ID);
    console.log("✅ Group exists:");
    console.log("   Admin:", group.admin);
    console.log("   Depth:", group.depth.toString());
    console.log("   Size:", group.size.toString());
    console.log("   Root:", group.root.toString());
    console.log("");

    if (group.admin.toLowerCase() !== ZKBOARD_ADDRESS.toLowerCase()) {
      console.error("❌ ERROR: ZKBoard is NOT the admin!");
      console.error(`   Expected: ${ZKBOARD_ADDRESS}`);
      console.error(`   Got: ${group.admin}`);
      return;
    }
    console.log("✅ ZKBoard is the admin\n");
  } catch (error: any) {
    console.error("❌ Failed to get group info:", error.message);
    return;
  }

  // Test addMember with a valid identity commitment
  const testCommitment = "5556523765678239248344434363368673229242075340660880759954215829137513951431";

  console.log("🧪 Testing addMember...");
  console.log("   Identity commitment:", testCommitment);
  console.log("");

  try {
    console.log("⏳ Calling addMember from deployer (should fail - not admin)...");
    const tx = await semaphore.addMember(GROUP_ID, testCommitment, {
      gasLimit: 2000000
    });
    console.log("✅ TX sent:", tx.hash);
    const receipt = await tx.wait();
    console.log("✅ Confirmed! Block:", receipt?.blockNumber);
    console.log("\n✅ SUCCESS! addMember works!");
  } catch (error: any) {
    console.error("\n❌ FAILED (expected - we're not admin):", error.message);
    if (error.reason) console.error("Reason:", error.reason);

    console.log("\n📝 This is expected - only ZKBoard (admin) can add members");
    console.log("   The issue is that ZKBoard's joinGroupWithDeposit is failing");
    console.log("   when IT tries to call addMember");
  }

  // Now let's check what happens when ZKBoard calls it
  console.log("\n" + "=".repeat(60));
  console.log("🧪 Testing via ZKBoard.joinGroupWithDeposit");
  console.log("=".repeat(60) + "\n");

  const zkboard = await ethers.getContractAt("ZKBoard", ZKBOARD_ADDRESS);

  try {
    console.log("⏳ Calling joinGroupWithDeposit...");
    const tx = await zkboard.joinGroupWithDeposit(testCommitment, {
      value: ethers.parseEther("0.05"),
      gasLimit: 2000000
    });
    console.log("✅ TX sent:", tx.hash);
    const receipt = await tx.wait();
    console.log("✅ Confirmed! Block:", receipt?.blockNumber);
    console.log("\n🎉 SUCCESS! Registration works!");
  } catch (error: any) {
    console.error("\n❌ FAILED:", error.message);
    if (error.reason) console.error("Reason:", error.reason);
    if (error.data) {
      console.error("Data:", error.data);

      // Try to decode the error
      try {
        const iface = new ethers.Interface([
          "error IncrementalBinaryTree__LeafGreaterThanSnarkScalarField()",
          "error Semaphore__GroupAlreadyExists()",
          "error Semaphore__GroupDoesNotExist()",
          "error Semaphore__CallerIsNotTheGroupAdmin()"
        ]);
        const decoded = iface.parseError(error.data);
        console.error("Decoded error:", decoded?.name);
      } catch (e) {
        console.error("Could not decode error");
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
