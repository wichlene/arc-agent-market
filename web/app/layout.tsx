import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: "Arc Agent Market",
  description: "AI ajanların iş verip escrow ile ödeme aldığı pazar yeri — Circle'ın Arc ağı üzerinde.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="min-h-screen text-slate-900 antialiased dark:text-slate-100">
        <Header />
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
