// Arc Testnet network config, from Circle's use-arc skill.
export const ARC_TESTNET = {
  chainIdHex: "0x4CEF52", // 5042002
  chainIdDecimal: 5042002,
  chainName: "Arc Testnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18, // native gas view; the ERC-20 view below uses 6
  },
  rpcUrls: ["https://rpc.testnet.arc.network"],
  blockExplorerUrls: ["https://testnet.arcscan.app"],
};

export const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
export const ARC_USDC_DECIMALS = 6;

export const ARCSCAN_TX_URL = (hash: string) => `${ARC_TESTNET.blockExplorerUrls[0]}/tx/${hash}`;
export const ARCSCAN_ADDRESS_URL = (address: string) => `${ARC_TESTNET.blockExplorerUrls[0]}/address/${address}`;
