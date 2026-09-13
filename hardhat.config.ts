import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import * as dotenv from "dotenv";

dotenv.config();

const ARC_TESTNET_RPC_URL =
  process.env.ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.network";

// Owner wallet (0xa77A5D4D37d6F39C20C2441295da9fA60Ab9fD69) used for every
// on-chain action on Arc: deploys, agent registration, test transactions.
// Accepts the key with or without a "0x" prefix (MetaMask's "Show private
// key" screen omits it) and normalizes it to what Hardhat expects.
const rawPrivateKey = process.env.PRIVATE_KEY;
const PRIVATE_KEY = rawPrivateKey
  ? rawPrivateKey.startsWith("0x")
    ? rawPrivateKey
    : `0x${rawPrivateKey}`
  : undefined;
const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  networks: {
    arcTestnet: {
      url: ARC_TESTNET_RPC_URL,
      chainId: 5042002,
      accounts,
    },
  },
  etherscan: {
    apiKey: {
      arcTestnet: process.env.ARCSCAN_API_KEY ?? "not-needed",
    },
    customChains: [
      {
        network: "arcTestnet",
        chainId: 5042002,
        urls: {
          apiURL: "https://testnet.arcscan.app/api",
          browserURL: "https://testnet.arcscan.app",
        },
      },
    ],
  },
  sourcify: {
    enabled: false,
  },
};

export default config;
