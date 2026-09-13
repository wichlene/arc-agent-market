"use client";

import { useCallback, useEffect, useState } from "react";
import { Contract, JsonRpcProvider, MaxUint256, ZeroAddress, ZeroHash, formatUnits, parseUnits } from "ethers";
import { ARC_TESTNET, ARC_USDC_ADDRESS, ARC_USDC_DECIMALS } from "@/lib/chain";
import { getJobEscrow, JOB_STATUS_LABELS, ADDRESSES } from "@/lib/contracts";
import { useWallet } from "@/lib/useWallet";
import { AddressLink, TxLink } from "@/components/AddressLink";

const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

const readProvider = new JsonRpcProvider(ARC_TESTNET.rpcUrls[0]);

type Job = {
  id: bigint;
  client: string;
  provider: string;
  evaluator: string;
  paymentToken: string;
  budget: bigint;
  status: number;
  description: string;
  expiresAt: bigint;
};

export default function JobsPage() {
  const { signer, address, isOnArcTestnet } = useWallet();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const jobEscrow = getJobEscrow(readProvider);
      const count: bigint = await jobEscrow.nextJobId();
      const list: Job[] = [];
      for (let i = 0n; i < count; i++) {
        const j = await jobEscrow.getJob(i);
        list.push({
          id: i,
          client: j.client,
          provider: j.provider,
          evaluator: j.evaluator,
          paymentToken: j.paymentToken,
          budget: j.budget,
          status: Number(j.status),
          description: j.description,
          expiresAt: j.expiresAt,
        });
      }
      list.reverse();
      setJobs(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  return (
    <div className="space-y-8">
      <section className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Job board</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            JobEscrow'daki (ERC-8183) tüm işler: Open → Funded → Submitted → Completed/Rejected/Expired.
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          disabled={!signer || !isOnArcTestnet}
          className="rounded-lg bg-arc-600 px-4 py-2 text-sm font-medium text-white hover:bg-arc-700 disabled:opacity-50"
        >
          {showCreate ? "Kapat" : "+ Yeni iş"}
        </button>
      </section>

      {showCreate && signer && <CreateJobForm signer={signer} onCreated={loadJobs} />}

      <section className="space-y-3">
        {loading && <p className="text-sm text-slate-500">Yükleniyor…</p>}
        {!loading && jobs.length === 0 && <p className="text-sm text-slate-500">Henüz iş yok.</p>}
        {jobs.map((job) => (
          <JobCard key={job.id.toString()} job={job} signer={signer} myAddress={address} onChanged={loadJobs} />
        ))}
      </section>
    </div>
  );
}

function CreateJobForm({ signer, onCreated }: { signer: any; onCreated: () => void }) {
  const [provider, setProvider] = useState("");
  const [evaluator, setEvaluator] = useState("");
  const [budget, setBudget] = useState("1");
  const [days, setDays] = useState("7");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setStatus(null);
    try {
      const jobEscrow = getJobEscrow(signer);
      const budgetWei = parseUnits(budget || "0", ARC_USDC_DECIMALS);
      const durationSeconds = BigInt(Math.max(1, Number(days))) * 24n * 60n * 60n;
      const tx = await jobEscrow.createJob(
        provider,
        evaluator || provider,
        ARC_USDC_ADDRESS,
        budgetWei,
        durationSeconds,
        description || "Arc Agent Market job",
        0,
        ZeroAddress
      );
      setStatus(`Gönderildi: ${tx.hash}`);
      await tx.wait();
      setStatus("İş oluşturuldu.");
      onCreated();
    } catch (e: any) {
      setStatus(e?.shortMessage ?? e?.message ?? "İşlem başarısız oldu.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-3 font-semibold">Yeni iş oluştur</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Provider (işi yapacak)">
          <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="0x…" className="input" />
        </Field>
        <Field label="Evaluator (boşsa provider ile aynı)">
          <input value={evaluator} onChange={(e) => setEvaluator(e.target.value)} placeholder="0x…" className="input" />
        </Field>
        <Field label="Bütçe (USDC)">
          <input value={budget} onChange={(e) => setBudget(e.target.value)} className="input" />
        </Field>
        <Field label="Süre (gün)">
          <input value={days} onChange={(e) => setDays(e.target.value)} className="input" />
        </Field>
        <Field label="Açıklama" full>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="input" />
        </Field>
      </div>
      <button
        onClick={submit}
        disabled={!provider || submitting}
        className="mt-4 rounded-lg bg-arc-600 px-4 py-2 text-sm font-medium text-white hover:bg-arc-700 disabled:opacity-50"
      >
        {submitting ? "Oluşturuluyor…" : "İşi oluştur"}
      </button>
      {status && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{status}</p>}
      <style jsx>{`
        .input {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid rgb(203 213 225);
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
        }
      `}</style>
    </section>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`block text-sm ${full ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function JobCard({
  job,
  signer,
  myAddress,
  onChanged,
}: {
  job: Job;
  signer: any;
  myAddress: string | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [deliverableURI, setDeliverableURI] = useState("");

  const me = myAddress?.toLowerCase();
  const isClient = me === job.client.toLowerCase();
  const isProvider = me === job.provider.toLowerCase();
  const isEvaluator = me === job.evaluator.toLowerCase();

  async function run(label: string, action: () => Promise<any>) {
    if (!signer) return;
    setBusy(true);
    setStatus(null);
    try {
      const tx = await action();
      setStatus(`${label}: gönderildi ${tx.hash}`);
      await tx.wait();
      setStatus(`${label}: tamamlandı`);
      onChanged();
    } catch (e: any) {
      setStatus(e?.shortMessage ?? e?.message ?? "İşlem başarısız oldu.");
    } finally {
      setBusy(false);
    }
  }

  async function handleFund() {
    await run("Fonlama", async () => {
      const usdc = new Contract(ARC_USDC_ADDRESS, USDC_ABI, signer);
      const jobEscrowAddress = ADDRESSES.JobEscrow;
      const allowance: bigint = await usdc.allowance(myAddress, jobEscrowAddress);
      if (allowance < job.budget) {
        const approveTx = await usdc.approve(jobEscrowAddress, MaxUint256);
        await approveTx.wait();
      }
      const jobEscrow = getJobEscrow(signer);
      return jobEscrow.fund(job.id);
    });
  }

  async function handleSubmit() {
    await run("Teslim", async () => {
      const jobEscrow = getJobEscrow(signer);
      return jobEscrow.submit(job.id, deliverableURI || "ipfs://deliverable", ZeroHash);
    });
  }

  async function handleComplete() {
    await run("Tamamlama", async () => {
      const jobEscrow = getJobEscrow(signer);
      return jobEscrow.complete(job.id, ZeroAddress);
    });
  }

  async function handleReject() {
    await run("Reddetme", async () => {
      const jobEscrow = getJobEscrow(signer);
      return jobEscrow.reject(job.id, "not satisfactory");
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          İş #{job.id.toString()} — {job.description}
        </span>
        <StatusBadge status={job.status} />
      </div>
      <dl className="mt-2 grid gap-1 text-sm text-slate-600 dark:text-slate-300 sm:grid-cols-2">
        <Row label="Client">
          <AddressLink address={job.client} />
        </Row>
        <Row label="Provider">
          <AddressLink address={job.provider} />
        </Row>
        <Row label="Evaluator">
          <AddressLink address={job.evaluator} />
        </Row>
        <Row label="Bütçe">{formatUnits(job.budget, ARC_USDC_DECIMALS)} USDC</Row>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {job.status === 0 && isClient && (
          <button onClick={handleFund} disabled={busy} className="btn-primary">
            Fonla
          </button>
        )}
        {job.status === 1 && isProvider && (
          <>
            <input
              value={deliverableURI}
              onChange={(e) => setDeliverableURI(e.target.value)}
              placeholder="teslimat URI"
              className="rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
            <button onClick={handleSubmit} disabled={busy} className="btn-primary">
              Teslim et
            </button>
          </>
        )}
        {job.status === 2 && isEvaluator && (
          <>
            <button onClick={handleComplete} disabled={busy} className="btn-primary">
              Onayla ve öde
            </button>
            <button
              onClick={handleReject}
              disabled={busy}
              className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              Reddet
            </button>
          </>
        )}
        {!signer && <span className="text-xs text-slate-500">İşlem yapmak için cüzdanını bağla.</span>}
      </div>
      {status && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{status}</p>}
      <style jsx>{`
        .btn-primary {
          border-radius: 0.5rem;
          background-color: #4f46e5;
          color: white;
          padding: 0.375rem 0.75rem;
          font-size: 0.875rem;
          font-weight: 500;
        }
        .btn-primary:disabled {
          opacity: 0.5;
        }
      `}</style>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-400">{label}:</span>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: number }) {
  const colors = [
    "bg-slate-100 text-slate-700",
    "bg-blue-100 text-blue-700",
    "bg-amber-100 text-amber-700",
    "bg-green-100 text-green-700",
    "bg-red-100 text-red-700",
    "bg-slate-200 text-slate-500",
  ];
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[status] ?? colors[0]}`}>
      {JOB_STATUS_LABELS[status] ?? "Unknown"}
    </span>
  );
}
