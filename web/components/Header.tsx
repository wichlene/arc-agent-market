"use client";

import Link from "next/link";
import { useWallet } from "@/lib/useWallet";

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function Header() {
  const { hasWallet, address, connecting, error, isOnArcTestnet, connect, switchOrAddArcTestnet } = useWallet();

  return (
    <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
        <Link href="/" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Arc Agent Market
        </Link>
        <nav className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-300">
          <Link href="/agents" className="hover:text-arc-600">
            Agents
          </Link>
          <Link href="/jobs" className="hover:text-arc-600">
            Jobs
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          {!hasWallet && (
            <span className="text-sm text-amber-600">Bir cüzdan (MetaMask) yükleyip sayfayı yenile.</span>
          )}
          {hasWallet && !address && (
            <button
              onClick={connect}
              disabled={connecting}
              className="rounded-lg bg-arc-600 px-4 py-2 text-sm font-medium text-white hover:bg-arc-700 disabled:opacity-50"
            >
              {connecting ? "Bağlanıyor…" : "Cüzdanı bağla"}
            </button>
          )}
          {hasWallet && address && !isOnArcTestnet && (
            <button
              onClick={switchOrAddArcTestnet}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
            >
              Arc Testnet'e geç
            </button>
          )}
          {hasWallet && address && isOnArcTestnet && (
            <span className="rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {short(address)}
            </span>
          )}
        </div>
      </div>
      {error && <p className="mx-auto max-w-5xl px-4 pb-2 text-sm text-red-600">{error}</p>}
    </header>
  );
}
