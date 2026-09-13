// Generates real on-chain activity from the owner wallet against the
// deployed Arc Agent Market contracts: registers the owner as agent #0 in
// the IdentityRegistry, then runs a tiny self-dealt JobEscrow job
// (create -> fund -> submit -> complete) using a small amount of real Arc
// USDC, so the wallet has genuine ERC-8004 / ERC-8183 transaction history
// on Arc Testnet.
//
// Run after `npm run deploy:arc-testnet`:
//   npx hardhat run scripts/interact.ts --network arcTestnet
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

async function main() {
  const deploymentFile = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(deploymentFile)) {
    throw new Error(`No deployment found at ${deploymentFile} — run 'npm run deploy:arc-testnet' first.`);
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));

  const [signer] = await ethers.getSigners();
  console.log(`Acting wallet: ${signer.address}`);

  const identityRegistry = await ethers.getContractAt("IdentityRegistry", deployment.contracts.IdentityRegistry, signer);
  const jobEscrow = await ethers.getContractAt("JobEscrow", deployment.contracts.JobEscrow, signer);
  const usdc = new ethers.Contract(ARC_USDC_ADDRESS, USDC_ABI, signer);

  // 1. Register as an agent (skip if the wallet already owns agent #0).
  let agentId: bigint;
  try {
    const owner0 = await identityRegistry.ownerOf(0);
    if (owner0.toLowerCase() === signer.address.toLowerCase()) {
      agentId = 0n;
      console.log("Already registered as agent #0.");
    } else {
      throw new Error("agent #0 owned by someone else");
    }
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
    agentId = registeredEvent ? registeredEvent.args.agentId : 0n;
    console.log(`Registered as agent #${agentId}. Tx: ${tx.hash}`);
  }

  // 2. Run a tiny self-dealt job to exercise the full ERC-8183 lifecycle.
  const budget = ethers.parseUnits("0.10", 6); // 0.10 USDC
  const usdcBalance: bigint = await usdc.balanceOf(signer.address);
  if (usdcBalance < budget) {
    console.log(
      `Skipping demo job: wallet has ${ethers.formatUnits(usdcBalance, 6)} USDC, need at least 0.10. ` +
        "Get testnet USDC from https://faucet.circle.com first."
    );
    return;
  }

  const allowance: bigint = await usdc.allowance(signer.address, deployment.contracts.JobEscrow);
  if (allowance < budget) {
    console.log("Approving JobEscrow to pull USDC...");
    await (await usdc.approve(deployment.contracts.JobEscrow, ethers.MaxUint256)).wait();
  }

  console.log("Creating demo job (client = provider = evaluator = this wallet)...");
  const createTx = await jobEscrow.createJob(
    signer.address,
    signer.address,
    ARC_USDC_ADDRESS,
    budget,
    7 * 24 * 60 * 60,
    "Arc Agent Market demo job",
    agentId,
    ethers.ZeroAddress
  );
  const createReceipt = await createTx.wait();
  const jobId = (await jobEscrow.nextJobId()) - 1n;
  console.log(`Job #${jobId} created. Tx: ${createTx.hash}`);

  console.log("Funding job...");
  await (await jobEscrow.fund(jobId)).wait();

  console.log("Submitting deliverable...");
  await (await jobEscrow.submit(jobId, "ipfs://arc-agent-market/demo-deliverable.json", ethers.ZeroHash)).wait();

  console.log("Completing job (releasing escrow)...");
  const completeTx = await jobEscrow.complete(jobId, ethers.ZeroAddress);
  await completeTx.wait();
  console.log(`Job #${jobId} completed. Tx: ${completeTx.hash}`);

  console.log("\nDone. Check activity at https://testnet.arcscan.app/address/" + signer.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
