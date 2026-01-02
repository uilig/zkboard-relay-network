import { ethers } from "hardhat";

async function main() {
  console.log("🧪 Testing addMember permission\n");

  const ZKBOARD_ADDRESS = "0x11BF67EAc7E78f7a83ff690BF2367F60ad84a55D";
  const GROUP_ID = 1767203234;
  const TEST_COMMITMENT = BigInt("12345678901234567890");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer (should be ZKBoard admin):", deployer.address);
  console.log("ZKBoard contract:", ZKBOARD_ADDRESS);
  console.log("");

  // Get ZKBoard contract
  const zkBoard = await ethers.getContractAt("ZKBoard", ZKBOARD_ADDRESS);

  // Try to call joinGroupWithDeposit
  console.log("Testing joinGroupWithDeposit...");
  console.log("Identity commitment:", TEST_COMMITMENT.toString());
  console.log("Deposit: 0.05 ETH");
  console.log("");

  try {
    const tx = await zkBoard.joinGroupWithDeposit(TEST_COMMITMENT, {
      value: ethers.parseEther("0.05"),
      gasLimit: 1000000,
    });
    console.log("✅ Transaction sent:", tx.hash);
    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed! Block:", receipt?.blockNumber);
    console.log("");
    console.log("✅ SUCCESS! ZKBoard can add members to Semaphore group!");
  } catch (error: any) {
    console.error("❌ FAILED:", error.message);
    if (error.reason) {
      console.error("Reason:", error.reason);
    }
    console.log("");
    console.log("Possible causes:");
    console.log("1. ZKBoard is not the admin of the Semaphore group");
    console.log("2. Identity commitment already exists");
    console.log("3. Identity commitment is invalid (> SNARK_SCALAR_FIELD)");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
