import { ethers } from "hardhat";

async function main() {
  console.log("🧪 Testing createGroup directly\n");

  const SEMAPHORE_ADDRESS = "0x7D78811554d5CB1D06B74f22B4Fa638aEdE4F5F0";
  const GROUP_ID = 1767204133;

  const [deployer] = await ethers.getSigners();
  console.log("Caller:", deployer.address);
  console.log("Semaphore:", SEMAPHORE_ADDRESS);
  console.log("Group ID:", GROUP_ID);
  console.log("");

  const semaphore = await ethers.getContractAt("Semaphore", SEMAPHORE_ADDRESS);

  try {
    console.log("⏳ Calling createGroup...");
    const tx = await semaphore.createGroup(GROUP_ID, 20, deployer.address, {
      gasLimit: 2000000
    });
    console.log("✅ TX sent:", tx.hash);
    const receipt = await tx.wait();
    console.log("✅ Confirmed! Block:", receipt?.blockNumber);
    console.log("\n✅ SUCCESS! createGroup works!");
  } catch (error: any) {
    console.error("\n❌ FAILED:", error.message);
    if (error.reason) console.error("Reason:", error.reason);
    if (error.data) console.error("Data:", error.data);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
