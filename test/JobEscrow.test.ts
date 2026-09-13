import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { JobEscrow as JobEscrowT, MockUSDC as MockUSDCT } from "../typechain-types";

const DAY = 24 * 60 * 60;

describe("JobEscrow (ERC-8183)", function () {
  async function deployFixture() {
    const [owner, client, provider, evaluator, feeRecipient, stranger] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = (await MockUSDC.deploy()) as unknown as MockUSDCT;
    await usdc.waitForDeployment();

    const JobEscrow = await ethers.getContractFactory("JobEscrow");
    const jobEscrow = (await upgrades.deployProxy(JobEscrow, [owner.address, feeRecipient.address], {
      kind: "uups",
    })) as unknown as JobEscrowT;
    await jobEscrow.waitForDeployment();

    await jobEscrow.connect(owner).setAllowedPaymentToken(await usdc.getAddress(), true);

    const budget = ethers.parseUnits("100", 6); // 100 USDC, 6 decimals like Arc's USDC
    await usdc.mint(client.address, budget * 10n);
    await usdc.connect(client).approve(await jobEscrow.getAddress(), budget * 10n);

    return { jobEscrow, usdc, owner, client, provider, evaluator, feeRecipient, stranger, budget };
  }

  async function createJob(jobEscrow: any, usdcAddress: string, client: any, provider: any, evaluator: any, budget: bigint) {
    const tx = await jobEscrow
      .connect(client)
      .createJob(provider.address, evaluator.address, usdcAddress, budget, 7 * DAY, "translate a doc", 0, ethers.ZeroAddress);
    await tx.wait();
    return 0n; // first job id
  }

  it("runs the full happy path: create -> fund -> submit -> complete", async function () {
    const { jobEscrow, usdc, client, provider, evaluator, feeRecipient, budget } = await loadFixture(deployFixture);

    const jobId = await createJob(jobEscrow, await usdc.getAddress(), client, provider, evaluator, budget);

    await jobEscrow.connect(client).fund(jobId);
    let job = await jobEscrow.getJob(jobId);
    expect(job.status).to.equal(1n); // Funded

    await jobEscrow.connect(provider).submit(jobId, "ipfs://deliverable", ethers.ZeroHash);
    job = await jobEscrow.getJob(jobId);
    expect(job.status).to.equal(2n); // Submitted

    const providerBalanceBefore = await usdc.balanceOf(provider.address);
    await expect(jobEscrow.connect(evaluator).complete(jobId, ethers.ZeroAddress))
      .to.emit(jobEscrow, "JobCompleted")
      .withArgs(jobId, provider.address, budget, 0n);

    job = await jobEscrow.getJob(jobId);
    expect(job.status).to.equal(3n); // Completed
    expect(await usdc.balanceOf(provider.address)).to.equal(providerBalanceBefore + budget);
    expect(await usdc.balanceOf(feeRecipient.address)).to.equal(0n);
  });

  it("routes the platform fee to feeRecipient on completion", async function () {
    const { jobEscrow, usdc, owner, client, provider, evaluator, feeRecipient, budget } = await loadFixture(deployFixture);

    await jobEscrow.connect(owner).setPlatformFee(250, feeRecipient.address); // 2.5%
    const jobId = await createJob(jobEscrow, await usdc.getAddress(), client, provider, evaluator, budget);
    await jobEscrow.connect(client).fund(jobId);
    await jobEscrow.connect(provider).submit(jobId, "ipfs://deliverable", ethers.ZeroHash);

    const expectedFee = (budget * 250n) / 10_000n;
    await jobEscrow.connect(evaluator).complete(jobId, ethers.ZeroAddress);

    expect(await usdc.balanceOf(feeRecipient.address)).to.equal(expectedFee);
    expect(await usdc.balanceOf(provider.address)).to.equal(budget - expectedFee);
  });

  it("refunds the client in full when the evaluator rejects", async function () {
    const { jobEscrow, usdc, client, provider, evaluator, budget } = await loadFixture(deployFixture);
    const jobId = await createJob(jobEscrow, await usdc.getAddress(), client, provider, evaluator, budget);
    await jobEscrow.connect(client).fund(jobId);
    await jobEscrow.connect(provider).submit(jobId, "ipfs://deliverable", ethers.ZeroHash);

    const clientBalanceBefore = await usdc.balanceOf(client.address);
    await expect(jobEscrow.connect(evaluator).reject(jobId, "low quality")).to.emit(jobEscrow, "JobRejected");

    expect(await usdc.balanceOf(client.address)).to.equal(clientBalanceBefore + budget);
    const job = await jobEscrow.getJob(jobId);
    expect(job.status).to.equal(4n); // Rejected
  });

  it("lets the client reclaim escrow if the provider never submits before the deadline", async function () {
    const { jobEscrow, usdc, client, provider, evaluator, budget } = await loadFixture(deployFixture);
    const jobId = await createJob(jobEscrow, await usdc.getAddress(), client, provider, evaluator, budget);
    await jobEscrow.connect(client).fund(jobId);

    await expect(jobEscrow.connect(client).reclaimExpired(jobId)).to.be.revertedWith("not expired yet");

    await time.increase(7 * DAY + 1);
    const clientBalanceBefore = await usdc.balanceOf(client.address);
    await jobEscrow.connect(client).reclaimExpired(jobId);

    expect(await usdc.balanceOf(client.address)).to.equal(clientBalanceBefore + budget);
    const job = await jobEscrow.getJob(jobId);
    expect(job.status).to.equal(5n); // Expired
  });

  it("force-refunds the client if the evaluator goes silent past the grace period", async function () {
    const { jobEscrow, usdc, client, provider, evaluator, budget } = await loadFixture(deployFixture);
    const jobId = await createJob(jobEscrow, await usdc.getAddress(), client, provider, evaluator, budget);
    await jobEscrow.connect(client).fund(jobId);
    await jobEscrow.connect(provider).submit(jobId, "ipfs://deliverable", ethers.ZeroHash);

    await time.increase(7 * DAY + 1); // past expiresAt, but still within grace period
    await expect(jobEscrow.connect(provider).forceRefund(jobId)).to.be.revertedWith("grace period active");

    await time.increase(60 * 60 + 1); // past the 1 hour grace period too
    await jobEscrow.connect(provider).forceRefund(jobId);

    const job = await jobEscrow.getJob(jobId);
    expect(job.status).to.equal(5n); // Expired
    expect(await usdc.balanceOf(client.address)).to.be.gt(0n);
  });

  it("rejects funding, submitting or completing out of order", async function () {
    const { jobEscrow, usdc, client, provider, evaluator, budget } = await loadFixture(deployFixture);
    const jobId = await createJob(jobEscrow, await usdc.getAddress(), client, provider, evaluator, budget);

    await expect(jobEscrow.connect(provider).submit(jobId, "x", ethers.ZeroHash)).to.be.revertedWith("not funded");
    await expect(jobEscrow.connect(evaluator).complete(jobId, ethers.ZeroAddress)).to.be.revertedWith("not submitted");
    await expect(jobEscrow.connect(provider).fund(jobId)).to.be.revertedWith("only client");
  });

  it("blocks job creation while paused", async function () {
    const { jobEscrow, usdc, owner, client, provider, evaluator, budget } = await loadFixture(deployFixture);
    await jobEscrow.connect(owner).pause();

    await expect(
      jobEscrow
        .connect(client)
        .createJob(provider.address, evaluator.address, await usdc.getAddress(), budget, DAY, "x", 0, ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(jobEscrow, "EnforcedPause");
  });

  it("only allows allowlisted payment tokens", async function () {
    const { jobEscrow, client, provider, evaluator, budget, stranger } = await loadFixture(deployFixture);

    await expect(
      jobEscrow
        .connect(client)
        .createJob(provider.address, evaluator.address, stranger.address, budget, DAY, "x", 0, ethers.ZeroAddress)
    ).to.be.revertedWith("token not allowed");
  });
});
