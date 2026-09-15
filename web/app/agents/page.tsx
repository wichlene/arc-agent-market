"use client";

import { useCallback, useEffect, useState } from "react";
import { ZeroHash, encodeBytes32String } from "ethers";
import { getReadProvider } from "@/lib/chain";
import { getIdentityRegistry, getReputationRegistry } from "@/lib/contracts";
import { useWallet } from "@/lib/useWallet";
import { AddressLink } from "@/components/AddressLink";
import { formatTxError } from "@/lib/errors";

type Agent = {
  agentId: bigint;
  owner: string;
  agentURI: string;
  agentWallet: string;
};

const readProvider = getReadProvider();

export default function AgentsPage() {
  const { signer, address, isOnArcTestnet } = useWallet();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [newAgentURI, setNewAgentURI] = useState("");
  const [registering, setRegistering] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const identityRegistry = getIdentityRegistry(readProvider);
      const list: Agent[] = [];
      for (let i = 0; ; i++) {
        try {
          const owner: string = await identityRegistry.ownerOf(i);
          const [agentURI, agentWallet] = await Promise.all([
            identityRegistry.tokenURI(i).catch(() => ""),
            identityRegistry.getAgentWallet(i) as Promise<string>,
          ]);
          list.push({ agentId: BigInt(i), owner, agentURI, agentWallet });
        } catch {
          break;
        }
      }
      setAgents(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  async function handleRegister() {
    if (!signer) return;
    setRegistering(true);
    setStatus(null);
    try {
      const identityRegistry = getIdentityRegistry(signer);
      const tx = newAgentURI.trim()
        ? await identityRegistry["register(string)"](newAgentURI.trim())
        : await identityRegistry["register()"]();
      setStatus(`İşlem gönderildi, onay bekleniyor: ${tx.hash}`);
      await tx.wait();
      setStatus(`Kaydoldun! Tx: ${tx.hash}`);
      setNewAgentURI("");
      await loadAgents();
    } catch (e: any) {
      setStatus(formatTxError(e));
    } finally {
      setRegistering(false);
    }
  }

  const knownClients = [...new Set(agents.map((a) => a.owner))];

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold">Agent'lar</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          IdentityRegistry'de (ERC-8004) kayıtlı tüm agent'lar. Her agent bir ERC-721 token.
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-3 font-semibold">Yeni agent kaydet</h2>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={newAgentURI}
            onChange={(e) => setNewAgentURI(e.target.value)}
            placeholder="agent card URI (opsiyonel, örn. ipfs://...)"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
          <button
            onClick={handleRegister}
            disabled={!signer || !isOnArcTestnet || registering}
            className="rounded-lg bg-arc-600 px-4 py-2 text-sm font-medium text-white hover:bg-arc-700 disabled:opacity-50"
          >
            {registering ? "Kaydediliyor…" : "Kaydol"}
          </button>
        </div>
        {!signer && <p className="mt-2 text-sm text-amber-600">Kaydolmak için cüzdanını bağla.</p>}
        {status && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{status}</p>}
      </section>

      <section className="space-y-3">
        {loading && <p className="text-sm text-slate-500">Yükleniyor…</p>}
        {!loading && agents.length === 0 && <p className="text-sm text-slate-500">Henüz kayıtlı agent yok.</p>}
        {agents.map((agent) => (
          <AgentCard key={agent.agentId.toString()} agent={agent} signer={signer} myAddress={address} knownClients={knownClients} />
        ))}
      </section>
    </div>
  );
}

function AgentCard({
  agent,
  signer,
  myAddress,
  knownClients,
}: {
  agent: Agent;
  signer: any;
  myAddress: string | null;
  knownClients: string[];
}) {
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [value, setValue] = useState("90");
  const [tag, setTag] = useState("job-quality");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ client: string; value: bigint; valueDecimals: number }[] | null>(null);

  const isSelf = myAddress?.toLowerCase() === agent.owner.toLowerCase();

  async function loadFeedback() {
    try {
      const reputationRegistry = getReputationRegistry(readProvider);
      const counts = await Promise.all(
        knownClients.map(async (client) => ({
          client,
          count: Number(await reputationRegistry.feedbackCount(agent.agentId, client)),
        }))
      );
      const items: { client: string; value: bigint; valueDecimals: number }[] = [];
      const reads: Promise<void>[] = [];
      for (const { client, count } of counts) {
        for (let i = 0; i < count; i++) {
          reads.push(
            reputationRegistry.readFeedback(agent.agentId, client, i).then((fb: any) => {
              if (!fb.revoked) {
                items.push({ client, value: fb.value, valueDecimals: fb.valueDecimals });
              }
            })
          );
        }
      }
      await Promise.all(reads);
      setFeedback(items);
    } catch {
      setFeedback([]);
    }
  }

  async function submitFeedback() {
    if (!signer) return;
    setSubmitting(true);
    setStatus(null);
    try {
      const reputationRegistry = getReputationRegistry(signer);
      const tag1 = tag.trim() ? encodeBytes32String(tag.trim().slice(0, 31)) : ZeroHash;
      const tx = await reputationRegistry.giveFeedback(agent.agentId, BigInt(value), 0, tag1, ZeroHash, "", ZeroHash);
      setStatus(`Gönderildi: ${tx.hash}`);
      await tx.wait();
      setStatus("Geri bildirim kaydedildi.");
      await loadFeedback();
    } catch (e: any) {
      setStatus(formatTxError(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-semibold">Agent #{agent.agentId.toString()}</span>
          <span className="ml-3 text-sm text-slate-500">
            sahip: <AddressLink address={agent.owner} />
          </span>
        </div>
        <span className="text-sm text-slate-500">
          ödeme cüzdanı:{" "}
          {agent.agentWallet === "0x0000000000000000000000000000000000000000" ? (
            "—"
          ) : (
            <AddressLink address={agent.agentWallet} />
          )}
        </span>
      </div>
      {agent.agentURI && <p className="mt-2 break-all text-sm text-slate-600 dark:text-slate-300">{agent.agentURI}</p>}

      <div className="mt-3 flex gap-3 text-sm">
        <button
          onClick={() => {
            setShowFeedbackForm((v) => !v);
            if (!feedback) loadFeedback();
          }}
          className="text-arc-600 hover:underline"
        >
          {showFeedbackForm ? "Kapat" : "Geri bildirimler"}
        </button>
      </div>

      {showFeedbackForm && (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3 dark:border-slate-800">
          {feedback === null && <p className="text-sm text-slate-500">Yükleniyor…</p>}
          {feedback?.length === 0 && <p className="text-sm text-slate-500">Henüz geri bildirim yok.</p>}
          {feedback && feedback.length > 0 && (
            <ul className="space-y-1 text-sm">
              {feedback.map((f, i) => (
                <li key={i}>
                  <AddressLink address={f.client} /> → {f.value.toString()} ({f.valueDecimals} decimal)
                </li>
              ))}
            </ul>
          )}

          {!isSelf && (
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-xs text-slate-500">Puan (0-100)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500">Etiket</label>
                <input
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  className="w-40 rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <button
                onClick={submitFeedback}
                disabled={!signer || submitting}
                className="rounded-lg bg-arc-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-arc-700 disabled:opacity-50"
              >
                {submitting ? "Gönderiliyor…" : "Geri bildirim ver"}
              </button>
            </div>
          )}
          {isSelf && <p className="text-xs text-slate-500">Kendi agent'ına geri bildirim veremezsin.</p>}
          {status && <p className="text-sm text-slate-600 dark:text-slate-300">{status}</p>}
        </div>
      )}
    </div>
  );
}
