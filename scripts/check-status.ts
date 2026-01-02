import { ethers } from "hardhat";

async function main() {
  const zkBoard = await ethers.getContractAt(
    "ZKBoard",
    "0xbB0d8200A285d6627B889Cbd299624DE6BcCE9C4" // Indirizzo dal tuo deployment
  );

  console.log("Checking ZKBoard status...\n");

  const nextRequestId = await zkBoard.nextRequestId();
  console.log("nextRequestId:", nextRequestId.toString());

  const messageCount = await zkBoard.messageCount();
  console.log("messageCount:", messageCount.toString());

  console.log("\n--- Relay Requests ---");
  if (nextRequestId > 0) {
    for (let i = 0; i < nextRequestId; i++) {
      try {
        const request = await zkBoard.relayRequests(i);
        console.log(`Request ${i}:`, {
          message: request.message,
          executed: request.executed,
          requester: request.requester,
        });
      } catch (e) {
        console.log(`Request ${i}: Error reading`);
      }
    }
  } else {
    console.log("No relay requests yet");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
