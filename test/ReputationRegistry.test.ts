import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type {
  IdentityRegistry as IdentityRegistryT,
  ReputationRegistry as ReputationRegistryT,
} from "../typechain-types";

const TAG_JOB = ethers.encodeBytes32String("job-quality");

describe("ReputationRegistry (ERC-8004)", function () {
  async function deployFixture() {
    const [owner, agentOwner, client1, client2] = await ethers.getSigners();

    const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
    const identityRegistry = (await upgrades.deployProxy(IdentityRegistry, [owner.address], {
      kind: "uups",
    })) as unknown as IdentityRegistryT;
    await identityRegistry.waitForDeployment();
    await identityRegistry.connect(agentOwner)["register()"]();

    const ReputationRegistry = await ethers.getContractFactory("ReputationRegistry");
    const reputationRegistry = (await upgrades.deployProxy(
      ReputationRegistry,
      [owner.address, await identityRegistry.getAddress()],
      { kind: "uups" }
    )) as unknown as ReputationRegistryT;
    await reputationRegistry.waitForDeployment();

    return { identityRegistry, reputationRegistry, owner, agentOwner, client1, client2 };
  }

  it("records feedback and prevents self-feedback", async function () {
    const { reputationRegistry, agentOwner, client1 } = await loadFixture(deployFixture);

    await expect(
      reputationRegistry.connect(agentOwner).giveFeedback(0, 9500, 2, TAG_JOB, ethers.ZeroHash, "ipfs://f", ethers.ZeroHash)
    ).to.be.revertedWith("no self-feedback");

    await expect(
      reputationRegistry.connect(client1).giveFeedback(0, 9500, 2, TAG_JOB, ethers.ZeroHash, "ipfs://f", ethers.ZeroHash)
    )
      .to.emit(reputationRegistry, "FeedbackGiven")
      .withArgs(0, client1.address, 0, 9500, 2, TAG_JOB, ethers.ZeroHash, "ipfs://f", ethers.ZeroHash);

    const entry = await reputationRegistry.readFeedback(0, client1.address, 0);
    expect(entry.value).to.equal(9500n);
    expect(entry.valueDecimals).to.equal(2);
  });

  it("aggregates a summary normalized to 18 decimals", async function () {
    const { reputationRegistry, client1, client2 } = await loadFixture(deployFixture);

    // 95.00 (2 decimals) and 85.0 (1 decimal) -> average 90.0
    await reputationRegistry.connect(client1).giveFeedback(0, 9500, 2, TAG_JOB, ethers.ZeroHash, "", ethers.ZeroHash);
    await reputationRegistry.connect(client2).giveFeedback(0, 850, 1, TAG_JOB, ethers.ZeroHash, "", ethers.ZeroHash);

    const [count, average, decimals] = await reputationRegistry.getSummary(
      0,
      [client1.address, client2.address],
      TAG_JOB,
      ethers.ZeroHash
    );

    expect(count).to.equal(2n);
    expect(decimals).to.equal(18);
    expect(average).to.equal(ethers.parseUnits("90", 18));
  });

  it("lets a client revoke their own feedback, excluding it from the summary", async function () {
    const { reputationRegistry, client1 } = await loadFixture(deployFixture);

    await reputationRegistry.connect(client1).giveFeedback(0, 100, 0, TAG_JOB, ethers.ZeroHash, "", ethers.ZeroHash);
    await reputationRegistry.connect(client1).revokeFeedback(0, 0);

    const [count] = await reputationRegistry.getSummary(0, [client1.address], TAG_JOB, ethers.ZeroHash);
    expect(count).to.equal(0n);
  });

  it("lets only the agent owner respond to feedback", async function () {
    const { reputationRegistry, agentOwner, client1, client2 } = await loadFixture(deployFixture);

    await reputationRegistry.connect(client1).giveFeedback(0, 100, 0, TAG_JOB, ethers.ZeroHash, "", ethers.ZeroHash);

    await expect(
      reputationRegistry.connect(client2).appendResponse(0, client1.address, 0, "ipfs://resp", ethers.ZeroHash)
    ).to.be.revertedWith("only agent owner");

    await reputationRegistry.connect(agentOwner).appendResponse(0, client1.address, 0, "ipfs://resp", ethers.ZeroHash);
    const entry = await reputationRegistry.readFeedback(0, client1.address, 0);
    expect(entry.hasResponse).to.equal(true);
    expect(entry.responseURI).to.equal("ipfs://resp");
  });
});
