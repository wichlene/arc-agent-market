// Deploys the full Arc Agent Market stack as UUPS proxies:
//   ERC-8004: IdentityRegistry, ReputationRegistry, ValidationRegistry
//   ERC-8183: JobEscrow (allowlisting Arc's native USDC as payment token)
//
// Run on Arc Testnet with:
//   npm run deploy:arc-testnet
// (requires PRIVATE_KEY for the owner wallet in .env — see .env.example)
import { ethers, network, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Arc's native USDC — same address on Arc Testnet and mainnet (from Circle's
// use-arc skill). 6 decimals as an ERC-20; the native gas view is 18.
const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Network: ${network.name}`);
  console.log(`Deployer / owner: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatUnits(await ethers.provider.getBalance(deployer.address), 18)} (native)`);

  const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
  const identityRegistry = await upgrades.deployProxy(IdentityRegistry, [deployer.address], { kind: "uups" });
  await identityRegistry.waitForDeployment();
  const identityRegistryAddress = await identityRegistry.getAddress();
  console.log(`IdentityRegistry (proxy): ${identityRegistryAddress}`);

  const ReputationRegistry = await ethers.getContractFactory("ReputationRegistry");
  const reputationRegistry = await upgrades.deployProxy(
    ReputationRegistry,
    [deployer.address, identityRegistryAddress],
    { kind: "uups" }
  );
  await reputationRegistry.waitForDeployment();
  const reputationRegistryAddress = await reputationRegistry.getAddress();
  console.log(`ReputationRegistry (proxy): ${reputationRegistryAddress}`);

  const ValidationRegistry = await ethers.getContractFactory("ValidationRegistry");
  const validationRegistry = await upgrades.deployProxy(
    ValidationRegistry,
    [deployer.address, identityRegistryAddress],
    { kind: "uups" }
  );
  await validationRegistry.waitForDeployment();
  const validationRegistryAddress = await validationRegistry.getAddress();
  console.log(`ValidationRegistry (proxy): ${validationRegistryAddress}`);

  const JobEscrow = await ethers.getContractFactory("JobEscrow");
  const jobEscrow = await upgrades.deployProxy(JobEscrow, [deployer.address, deployer.address], { kind: "uups" });
  await jobEscrow.waitForDeployment();
  const jobEscrowAddress = await jobEscrow.getAddress();
  console.log(`JobEscrow (proxy): ${jobEscrowAddress}`);

  const isArc = network.name === "arcTestnet";
  if (isArc) {
    console.log(`Allowlisting Arc USDC (${ARC_USDC_ADDRESS}) as a JobEscrow payment token...`);
    const tx = await jobEscrow.setAllowedPaymentToken(ARC_USDC_ADDRESS, true);
    await tx.wait();
  } else {
    console.log("Not on Arc Testnet — skipping USDC allowlisting (deploy a MockUSDC for local testing instead).");
  }

  const deployment = {
    network: network.name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: {
      IdentityRegistry: identityRegistryAddress,
      ReputationRegistry: reputationRegistryAddress,
      ValidationRegistry: validationRegistryAddress,
      JobEscrow: jobEscrowAddress,
    },
    paymentTokens: isArc ? { USDC: ARC_USDC_ADDRESS } : {},
  };

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network.name}.json`);
  fs.writeFileSync(outFile, JSON.stringify(deployment, null, 2));
  console.log(`\nDeployment addresses written to ${path.relative(process.cwd(), outFile)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
