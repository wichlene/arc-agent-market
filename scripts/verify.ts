// Verifies all deployed proxies (and their implementations, auto-detected by
// the @openzeppelin/hardhat-upgrades <-> hardhat-verify integration) on
// Arcscan. Read-only — no private key needed.
//   npx hardhat run scripts/verify.ts --network arcTestnet
import { run, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const deploymentFile = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(deploymentFile)) {
    throw new Error(`No deployment found at ${deploymentFile} — run 'npm run deploy:arc-testnet' first.`);
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));

  for (const [name, address] of Object.entries(deployment.contracts)) {
    console.log(`\nVerifying ${name} at ${address}...`);
    try {
      await run("verify:verify", { address, constructorArguments: [] });
      console.log(`${name}: done.`);
    } catch (e: any) {
      console.log(`${name}: ${e.message}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
