import { ethers } from "hardhat";

async function main() {
  const zkBoard = await ethers.getContractAt(
    "ZKBoard",
    "0xbB0d8200A285d6627B889Cbd299624DE6BcCE9C4"
  );

  const requestId = 3;
  console.log(`Checking request ${requestId}...\n`);

  try {
    const request = await zkBoard.relayRequests(requestId);
    console.log("Request data:");
    console.log("- merkleTreeRoot:", request.merkleTreeRoot.toString());
    console.log("- nullifierHash:", request.nullifierHash.toString());
    console.log("- message:", request.message);
    console.log("- message length:", request.message.length);
    console.log("- relayFee:", ethers.formatEther(request.relayFee), "ETH");
    console.log("- requester:", request.requester);
    console.log("- executed:", request.executed);
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
