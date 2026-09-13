"use client";

import { useCallback, useEffect, useState } from "react";
import { BrowserProvider, type JsonRpcSigner } from "ethers";
import { ARC_TESTNET } from "./chain";

declare global {
  interface Window {
    ethereum?: any;
  }
}

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasWallet = typeof window !== "undefined" && Boolean(window.ethereum);

  const refresh = useCallback(async () => {
    if (!window.ethereum) return;
    const provider = new BrowserProvider(window.ethereum);
    const network = await provider.getNetwork();
    setChainId(Number(network.chainId));
    const accounts: string[] = await window.ethereum.request({ method: "eth_accounts" });
    if (accounts.length > 0) {
      const s = await provider.getSigner();
      setSigner(s);
      setAddress(accounts[0]);
    } else {
      setSigner(null);
      setAddress(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    if (!window.ethereum) return;
    const onAccountsChanged = () => refresh();
    const onChainChanged = () => refresh();
    window.ethereum.on?.("accountsChanged", onAccountsChanged);
    window.ethereum.on?.("chainChanged", onChainChanged);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", onAccountsChanged);
      window.ethereum?.removeListener?.("chainChanged", onChainChanged);
    };
  }, [refresh]);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError("Tarayıcında bir cüzdan (MetaMask vb.) bulunamadı.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? "Bağlanma başarısız.");
    } finally {
      setConnecting(false);
    }
  }, [refresh]);

  const switchOrAddArcTestnet = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ARC_TESTNET.chainIdHex }],
      });
    } catch (switchError: any) {
      if (switchError?.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: ARC_TESTNET.chainIdHex,
              chainName: ARC_TESTNET.chainName,
              nativeCurrency: ARC_TESTNET.nativeCurrency,
              rpcUrls: ARC_TESTNET.rpcUrls,
              blockExplorerUrls: ARC_TESTNET.blockExplorerUrls,
            },
          ],
        });
      } else {
        setError(switchError?.message ?? "Ağ değiştirilemedi.");
      }
    }
    await refresh();
  }, [refresh]);

  const isOnArcTestnet = chainId === ARC_TESTNET.chainIdDecimal;

  return {
    hasWallet,
    address,
    chainId,
    signer,
    connecting,
    error,
    isOnArcTestnet,
    connect,
    switchOrAddArcTestnet,
    refresh,
  };
}
