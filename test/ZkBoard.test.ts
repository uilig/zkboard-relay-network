import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("ZkBoard System", function () {
  
  // Questa funzione prepara l'ambiente prima di ogni test
  async function deployFixture() {
    const [admin, user] = await ethers.getSigners();

    // 1. Deploy del Mock (il finto Semaphore)
    const MockFactory = await ethers.getContractFactory("MockSemaphore");
    const mockSemaphore = await MockFactory.deploy();
    
    // 2. Deploy del Nostro Contratto (ZkBoard)
    const ZkBoardFactory = await ethers.getContractFactory("ZkBoard");
    
    // Passiamo l'indirizzo del Mock e la durata epoca (300 secondi = 5 minuti)
    const zkBoard = await ZkBoardFactory.deploy(mockSemaphore.target, 300);

    return { zkBoard, mockSemaphore, admin, user };
  }

  it("Dovrebbe creare un gruppo su Semaphore all'avvio", async function () {
    const { zkBoard } = await loadFixture(deployFixture);
    
    // Verifichiamo che abbia salvato l'ID del gruppo (dovrebbe essere 1 perché è il primo del mock)
    expect(await zkBoard.groupId()).to.equal(1);
  });

  it("Dovrebbe permettere all'admin di aggiungere un membro", async function () {
    const { zkBoard } = await loadFixture(deployFixture);
    
    // Inventiamo un Identity Commitment finto (un numero a caso)
    const fakeIdentityCommitment = 123456789;

    // Proviamo ad aggiungere il membro
    await expect(zkBoard.joinGroup(fakeIdentityCommitment))
      .not.to.be.reverted; // Speriamo che non dia errore
  });

  it("Dovrebbe pubblicare un messaggio e calcolare l'epoca corretta", async function () {
    const { zkBoard } = await loadFixture(deployFixture);

    // Dati finti per il test
    const fakeMessageHash = ethers.keccak256(ethers.toUtf8Bytes("Ciao Mondo"));
    const fakeRoot = 0;
    const fakeNullifier = 123;
    const fakeProof = [0,0,0,0,0,0,0,0]; // Una prova vuota (tanto il Mock dice sempre sì)
    const depth = 20;

    // Pubblichiamo!
    // Nota: Il Mock risponderà "True", quindi ZkBoard dovrebbe emettere l'evento
    await expect(zkBoard.publishMessage(fakeMessageHash, fakeRoot, fakeNullifier, fakeProof, depth))
      .to.emit(zkBoard, "NewMessage") // Controlliamo se l'evento è stato "sparato"
      .withArgs(fakeMessageHash, (val: any) => val > 0); // Controlliamo che ci sia l'hash
  });
});
