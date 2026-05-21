"use client";

import CompLabPage from "@/components/complab/CompLabPage";

/** Full-width Comp Lab workspace; delegates to `CompLabPage`. */
export default function CompLabShell() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <CompLabPage />
    </div>
  );
}
