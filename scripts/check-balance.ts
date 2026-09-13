// Quick sanity check before deploying: prints the owner wallet's native
// (gas) balance and Arc USDC balance on whichever network you point it at.
//   npx hardhat run scripts/check-balance.ts --network arcTestnet
import { ethers, network } from "hardhat";

const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const USDC_ABI = ["function balanceOf(address) view returns (uint256)"];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log(`Network: ${network.name}`);
  console.log(`Wallet: ${signer.address}`);

  const nativeBalance = await ethers.provider.getBalance(signer.address);
  console.log(`Native balance: ${ethers.formatUnits(nativeBalance, 18)}`);

  if (network.name === "arcTestnet") {
    const usdc = new ethers.Contract(ARC_USDC_ADDRESS, USDC_ABI, ethers.provider);
    const usdcBalance = await usdc.balanceOf(signer.address);
    console.log(`USDC balance: ${ethers.formatUnits(usdcBalance, 6)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
