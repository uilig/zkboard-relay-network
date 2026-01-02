import { ethers } from "hardhat";

async function main() {
  const zkBoard = await ethers.getContractAt(
    "ZKBoard",
    "0xbB0d8200A285d6627B889Cbd299624DE6BcCE9C4"
  );

  console.log("Checking messages on-chain...\n");

  const messageCount = await zkBoard.messageCount();
  console.log("messageCount:", messageCount.toString());

  if (messageCount > 0) {
    console.log("\n--- Messages ---");
    for (let i = 0; i < messageCount; i++) {
      try {
        const message = await zkBoard.messages(i);
        console.log(`\nMessage ${i}:`);
        console.log("  content:", message.content);
        console.log("  timestamp:", new Date(Number(message.timestamp) * 1000).toISOString());
        console.log("  nullifierHash:", message.nullifierHash.toString());
        console.log("  flagCount:", message.flagCount.toString());
      } catch (e) {
        console.log(`Message ${i}: Error reading`);
      }
    }
  } else {
    console.log("\nNo messages found on-chain!");
  }

  // Check relay requests status
  console.log("\n--- Relay Requests Status ---");
  const nextRequestId = await zkBoard.nextRequestId();
  for (let i = 0; i < nextRequestId; i++) {
    const request = await zkBoard.relayRequests(i);
    console.log(`Request ${i}: executed=${request.executed}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
