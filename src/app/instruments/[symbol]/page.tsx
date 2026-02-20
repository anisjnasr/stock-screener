import Link from "next/link";
import { InstrumentOverview } from "@/components/Instrument/InstrumentOverview";

export default async function InstrumentPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <Link href="/" className="hover:text-white">
          Home
        </Link>
        <span>/</span>
        <span className="text-white">{symbol}</span>
      </div>
      <InstrumentOverview symbol={symbol} />
    </div>
  );
}
