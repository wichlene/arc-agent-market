// Generates real on-chain activity from the owner wallet against the
// deployed Arc Agent Market contracts: registers the owner as agent #0 in
// the IdentityRegistry, requests+responds to a self validation in the
// ValidationRegistry, then runs a handful of tiny self-dealt JobEscrow jobs
// (create -> fund -> submit -> complete) using real Arc USDC — so the
// wallet accumulates genuine, varied ERC-8004 / ERC-8183 transaction
// history on Arc Testnet.
//
// Run after `npm run deploy:arc-testnet`:
//   npx hardhat run scripts/interact.ts --network arcTestnet
//
// Set JOB_COUNT to run more than the default 3 demo jobs, e.g.:
//   JOB_COUNT=10 npx hardhat run scripts/interact.ts --network arcTestnet
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];
const JOB_COUNT = Number(process.env.JOB_COUNT ?? "3");
const JOB_BUDGET = ethers.parseUnits("0.10", 6); // 0.10 USDC per demo job

async function registerAgentIfNeeded(identityRegistry: any, signer: any): Promise<bigint> {
  try {
    const owner0 = await identityRegistry.ownerOf(0);
    if (owner0.toLowerCase() === signer.address.toLowerCase()) {
      console.log("Already registered as agent #0.");
      return 0n;
    }
    throw new Error("agent #0 owned by someone else");
  } catch {
    console.log("Registering as a new agent...");
    const tx = await identityRegistry["register(string)"]("ipfs://arc-agent-market/agent-0.json");
    const receipt = await tx.wait();
    const registeredEvent = receipt!.logs
      .map((log: any) => {
        try {
          return identityRegistry.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed: any) => parsed?.name === "Registered");
    const agentId: bigint = registeredEvent ? registeredEvent.args.agentId : 0n;
    console.log(`Registered as agent #${agentId}. Tx: ${tx.hash}`);
    return agentId;
  }
}

async function runSelfValidation(validationRegistry: any, signer: any, agentId: bigint) {
  console.log("Requesting a self-validation on ValidationRegistry...");
  const reqTx = await validationRegistry.validationRequest(
    signer.address,
    agentId,
    "ipfs://arc-agent-market/validation-request.json",
    ethers.ZeroHash
  );
  const receipt = await reqTx.wait();
  const requested = receipt!.logs
    .map((log: any) => {
      try {
        return validationRegistry.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed: any) => parsed?.name === "ValidationRequested");
  const requestId = requested?.args.requestId;
  console.log(`Validation requested. Tx: ${reqTx.hash}`);

  if (!requestId) {
    console.log("Could not parse requestId from logs, skipping the response step.");
    return;
  }

  console.log("Responding to the validation request...");
  const respTx = await validationRegistry.validationResponse(
    requestId,
    100,
    "ipfs://arc-agent-market/validation-response.json",
    ethers.ZeroHash,
    ethers.encodeBytes32String("self-check")
  );
  await respTx.wait();
  console.log(`Validation responded. Tx: ${respTx.hash}`);
}

async function runDemoJob(jobEscrow: any, signer: any, agentId: bigint, index: number) {
  console.log(`\n--- Demo job ${index + 1}/${JOB_COUNT} ---`);
  console.log("Creating job (client = provider = evaluator = this wallet)...");
  const createTx = await jobEscrow.createJob(
    signer.address,
    signer.address,
    ARC_USDC_ADDRESS,
    JOB_BUDGET,
    7 * 24 * 60 * 60,
    `Arc Agent Market demo job #${index + 1}`,
    agentId,
    ethers.ZeroAddress
  );
  await createTx.wait();
  const jobId = (await jobEscrow.nextJobId()) - 1n;
  console.log(`Job #${jobId} created. Tx: ${createTx.hash}`);

  console.log("Funding job...");
  await (await jobEscrow.fund(jobId)).wait();

  console.log("Submitting deliverable...");
  await (
    await jobEscrow.submit(jobId, `ipfs://arc-agent-market/demo-deliverable-${index + 1}.json`, ethers.ZeroHash)
  ).wait();

  console.log("Completing job (releasing escrow)...");
  const completeTx = await jobEscrow.complete(jobId, ethers.ZeroAddress);
  await completeTx.wait();
  console.log(`Job #${jobId} completed. Tx: ${completeTx.hash}`);
}

async function main() {
  const deploymentFile = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(deploymentFile)) {
    throw new Error(`No deployment found at ${deploymentFile} — run 'npm run deploy:arc-testnet' first.`);
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));

  const [signer] = await ethers.getSigners();
  console.log(`Acting wallet: ${signer.address}`);

  const identityRegistry = await ethers.getContractAt("IdentityRegistry", deployment.contracts.IdentityRegistry, signer);
  const validationRegistry = await ethers.getContractAt(
    "ValidationRegistry",
    deployment.contracts.ValidationRegistry,
    signer
  );
  const jobEscrow = await ethers.getContractAt("JobEscrow", deployment.contracts.JobEscrow, signer);
  const usdc = new ethers.Contract(ARC_USDC_ADDRESS, USDC_ABI, signer);

  // 1. Identity: register (or reuse) agent #0.
  const agentId = await registerAgentIfNeeded(identityRegistry, signer);

  // 2. Validation: exercise the request/response flow (self-validation, since
  // this script only has one wallet available).
  await runSelfValidation(validationRegistry, signer, agentId);

  // 3. Job escrow: run a handful of full job lifecycles.
  const totalBudget = JOB_BUDGET * BigInt(JOB_COUNT);
  const usdcBalance: bigint = await usdc.balanceOf(signer.address);
  if (usdcBalance < totalBudget) {
    console.log(
      `\nSkipping demo jobs: wallet has ${ethers.formatUnits(usdcBalance, 6)} USDC, need at least ` +
        `${ethers.formatUnits(totalBudget, 6)} for ${JOB_COUNT} job(s). Get testnet USDC from https://faucet.circle.com first.`
    );
    return;
  }

  const allowance: bigint = await usdc.allowance(signer.address, deployment.contracts.JobEscrow);
  if (allowance < totalBudget) {
    console.log("Approving JobEscrow to pull USDC...");
    await (await usdc.approve(deployment.contracts.JobEscrow, ethers.MaxUint256)).wait();
  }

  for (let i = 0; i < JOB_COUNT; i++) {
    await runDemoJob(jobEscrow, signer, agentId, i);
  }

  console.log("\nDone. Check activity at https://testnet.arcscan.app/address/" + signer.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
