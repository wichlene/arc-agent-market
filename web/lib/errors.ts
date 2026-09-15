/**
 * Ethers often wraps an RPC/wallet error it can't classify into a generic
 * "could not coalesce error" (code UNKNOWN_ERROR) — but the original,
 * actually-useful message is still sitting in `error.info.error`. Surface
 * as much of that as we can instead of showing the meaningless wrapper.
 */
export function formatTxError(e: any): string {
  if (!e) return "İşlem başarısız oldu.";

  const nestedMessage: string | undefined = e?.info?.error?.message ?? e?.info?.error?.data?.message;
  const method: string | undefined = e?.info?.payload?.method;

  const parts: string[] = [];
  if (e.shortMessage && e.shortMessage !== "could not coalesce error") parts.push(e.shortMessage);
  if (nestedMessage && !parts.includes(nestedMessage)) parts.push(nestedMessage);
  if (parts.length === 0 && e.message) parts.push(e.message);
  if (method) parts.push(`(method: ${method})`);

  return parts.length > 0 ? parts.join(" — ") : "İşlem başarısız oldu.";
}
