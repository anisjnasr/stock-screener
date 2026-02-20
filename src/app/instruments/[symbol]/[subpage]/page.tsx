import Link from "next/link";
import { AISubpage } from "@/components/Instrument/AISubpage";

const PREDEFINED_PROMPTS: Record<string, string> = {
  "market-positioning":
    "Analyze the current market positioning for this stock. Consider price action, volume trends, and how the stock is positioned relative to its sector and the broader market. Keep the analysis concise and relevant for a retail trader.",
  "industry-analysis":
    "Provide a brief industry analysis: key trends, competitive landscape, and where this company sits within its industry. Focus on factors that could affect the stock.",
  "competitors":
    "List and briefly analyze the main competitors of this company. Compare strengths and any notable metrics (e.g. market share, growth) where relevant.",
  "strengths-weaknesses":
    "Summarize the main strengths and weaknesses of this company from an investment perspective. Be factual and concise.",
  "earnings-analysis":
    "Analyze the most recent earnings and management commentary. Highlight key metrics, surprises, and what to watch in the next report.",
};

export default async function PredefinedSubpage({
  params,
}: {
  params: Promise<{ symbol: string; subpage: string }>;
}) {
  const { symbol, subpage } = await params;
  const prompt = PREDEFINED_PROMPTS[subpage];
  if (!prompt) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
        <p className="text-zinc-400">Unknown analysis type.</p>
        <Link href={`/instruments/${symbol}`} className="mt-2 inline-block text-emerald-400 hover:underline">
          Back to overview
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <Link href="/" className="hover:text-white">Home</Link>
        <span>/</span>
        <Link href={`/instruments/${symbol}`} className="hover:text-white">{symbol}</Link>
        <span>/</span>
        <span className="text-white">{subpage}</span>
      </div>
      <AISubpage symbol={symbol} prompt={prompt} />
    </div>
  );
}
