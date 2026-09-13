import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { IdentityRegistry as IdentityRegistryT } from "../typechain-types";

describe("IdentityRegistry (ERC-8004)", function () {
  async function deployFixture() {
    const [owner, agentOwner, other] = await ethers.getSigners();

    const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
    const identityRegistry = (await upgrades.deployProxy(IdentityRegistry, [owner.address], {
      kind: "uups",
    })) as unknown as IdentityRegistryT;
    await identityRegistry.waitForDeployment();

    return { identityRegistry, owner, agentOwner, other };
  }

  it("registers a bare agent and records the caller as its agentWallet", async function () {
    const { identityRegistry, agentOwner } = await loadFixture(deployFixture);

    const tx = await identityRegistry.connect(agentOwner)["register()"]();
    await expect(tx).to.emit(identityRegistry, "Registered").withArgs(0n, "", agentOwner.address);

    expect(await identityRegistry.ownerOf(0)).to.equal(agentOwner.address);
    expect(await identityRegistry.getAgentWallet(0)).to.equal(agentOwner.address);
  });

  it("registers with a URI and metadata entries", async function () {
    const { identityRegistry, agentOwner } = await loadFixture(deployFixture);

    await identityRegistry.connect(agentOwner)["register(string,(string,bytes)[])"]("ipfs://agent-card", [
      { metadataKey: "skills", metadataValue: ethers.toUtf8Bytes("coding,research") },
    ]);

    expect(await identityRegistry.tokenURI(0)).to.equal("ipfs://agent-card");
    expect(await identityRegistry.getMetadata(0, "skills")).to.equal(
      ethers.hexlify(ethers.toUtf8Bytes("coding,research"))
    );
  });

  it("rejects setting the reserved agentWallet key via setMetadata", async function () {
    const { identityRegistry, agentOwner } = await loadFixture(deployFixture);
    await identityRegistry.connect(agentOwner)["register()"]();

    await expect(
      identityRegistry.connect(agentOwner).setMetadata(0, "agentWallet", "0x00")
    ).to.be.revertedWith("reserved key");
  });

  it("only the agent owner (or approved) can update the URI", async function () {
    const { identityRegistry, agentOwner, other } = await loadFixture(deployFixture);
    await identityRegistry.connect(agentOwner)["register()"]();

    await expect(identityRegistry.connect(other).setAgentURI(0, "ipfs://new")).to.be.revertedWith(
      "Not authorized"
    );

    await identityRegistry.connect(agentOwner).setAgentURI(0, "ipfs://new");
    expect(await identityRegistry.tokenURI(0)).to.equal("ipfs://new");
  });

  it("clears the agentWallet slot on transfer", async function () {
    const { identityRegistry, agentOwner, other } = await loadFixture(deployFixture);
    await identityRegistry.connect(agentOwner)["register()"]();

    await identityRegistry
      .connect(agentOwner)
      .transferFrom(agentOwner.address, other.address, 0);

    expect(await identityRegistry.getAgentWallet(0)).to.equal(ethers.ZeroAddress);
  });
});
