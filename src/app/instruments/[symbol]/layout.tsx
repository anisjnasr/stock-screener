import { InstrumentNav } from "@/components/Instrument/InstrumentNav";

export default function InstrumentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <InstrumentNav />
      {children}
    </div>
  );
}
