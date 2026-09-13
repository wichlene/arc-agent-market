// Verifies all deployed proxies (and their implementations, auto-detected by
// the @openzeppelin/hardhat-upgrades <-> hardhat-verify integration) on
// Arcscan. Read-only — no private key needed.
//   npx hardhat run scripts/verify.ts --network arcTestnet
//
// Set CONTRACTS to a comma-separated subset of names (matching the keys in
// deployments/<network>.json's "contracts" object) to only (re)try those —
// useful when some contracts already verified and you're just mopping up
// the rest without burning rate-limit budget re-checking done ones.
//   CONTRACTS=ValidationRegistry,JobEscrow npx hardhat run scripts/verify.ts --network arcTestnet
import { run, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Arcscan (Blockscout) rate-limits its public API aggressively — even with
// an API key, back-to-back calls (implementation + proxy + link, each with
// their own polling) trip it. Back off between contracts.
const DELAY_BETWEEN_CONTRACTS_MS = 90_000;

async function main() {
  const deploymentFile = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(deploymentFile)) {
    throw new Error(`No deployment found at ${deploymentFile} — run 'npm run deploy:arc-testnet' first.`);
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));

  const only = process.env.CONTRACTS?.trim() ? process.env.CONTRACTS.split(",").map((s) => s.trim()) : undefined;
  const entries = Object.entries(deployment.contracts).filter(([name]) => !only || only.includes(name));
  if (entries.length === 0) {
    console.log(`No contracts matched CONTRACTS="${process.env.CONTRACTS}". Available: ${Object.keys(deployment.contracts).join(", ")}`);
    return;
  }
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
