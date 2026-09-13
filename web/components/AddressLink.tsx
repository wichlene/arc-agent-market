import { ARCSCAN_ADDRESS_URL, ARCSCAN_TX_URL } from "@/lib/chain";

function short(value: string, chars = 4) {
  return `${value.slice(0, 2 + chars)}…${value.slice(-chars)}`;
}

export function AddressLink({ address }: { address: string }) {
  return (
    <a
      href={ARCSCAN_ADDRESS_URL(address)}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-arc-600 hover:underline dark:text-arc-500"
      title={address}
    >
      {short(address)}
    </a>
  );
}

export function TxLink({ hash, children }: { hash: string; children?: React.ReactNode }) {
  return (
    <a
      href={ARCSCAN_TX_URL(hash)}
      target="_blank"
      rel="noreferrer"
      className="text-arc-600 hover:underline dark:text-arc-500"
    >
      {children ?? short(hash, 6)}
    </a>
  );
}
