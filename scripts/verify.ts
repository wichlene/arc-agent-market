// Verifies all deployed proxies (and their implementations, auto-detected by
// the @openzeppelin/hardhat-upgrades <-> hardhat-verify integration) on
// Arcscan. Read-only — no private key needed.
//   npx hardhat run scripts/verify.ts --network arcTestnet
import { run, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Arcscan (Blockscout) rate-limits its public API fairly aggressively; back
// off between contracts so a fresh run doesn't get 429'd after the first one.
const DELAY_BETWEEN_CONTRACTS_MS = 15_000;

async function main() {
  const deploymentFile = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(deploymentFile)) {
    throw new Error(`No deployment found at ${deploymentFile} — run 'npm run deploy:arc-testnet' first.`);
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));

  const entries = Object.entries(deployment.contracts);
  for (let i = 0; i < entries.length; i++) {
    const [name, address] = entries[i];
    console.log(`\nVerifying ${name} at ${address}...`);
    try {
      await run("verify:verify", { address, constructorArguments: [] });
      console.log(`${name}: done.`);
    } catch (e: any) {
      console.log(`${name}: ${e.message}`);
    }

    if (i < entries.length - 1) {
      console.log(`Waiting ${DELAY_BETWEEN_CONTRACTS_MS / 1000}s before the next contract (rate limit)...`);
      await sleep(DELAY_BETWEEN_CONTRACTS_MS);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
