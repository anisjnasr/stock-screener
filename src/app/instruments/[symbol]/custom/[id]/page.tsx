import Link from "next/link";
import { CustomAISubpage } from "@/components/Instrument/CustomAISubpage";

export default async function CustomSubpage({
  params,
}: {
  params: Promise<{ symbol: string; id: string }>;
}) {
  const { symbol, id } = await params;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <Link href="/" className="hover:text-white">Home</Link>
        <span>/</span>
        <Link href={`/instruments/${symbol}`} className="hover:text-white">{symbol}</Link>
        <span>/</span>
        <span className="text-white">Custom</span>
      </div>
      <CustomAISubpage symbol={symbol} promptId={id} />
    </div>
  );
}
