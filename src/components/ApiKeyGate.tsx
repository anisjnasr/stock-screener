"use client";

import { useState, useEffect, useCallback } from "react";
import { getStoredApiKey, setStoredApiKey, clearStoredApiKey } from "@/lib/api";
import Link from "next/link";

export function ApiKeyGate({ children }: { children: React.ReactNode }) {
  const [key, setKey] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setKey(getStoredApiKey());
    setLoading(false);
  }, []);

  const validateAndSave = useCallback(async () => {
    const k = input.trim();
    if (!k) {
      setError("Enter an access key");
      return;
    }
    setError("");
    setStoredApiKey(k);
    setKey(k);
    setInput("");
    window.dispatchEvent(new Event("storage"));
  }, [input]);

  const logout = useCallback(() => {
    clearStoredApiKey();
    setKey(null);
    setInput("");
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-900">
        <div className="text-zinc-400">Loading…</div>
      </div>
    );
  }

  if (!key) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-900 p-4">
        <div className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-800 p-6 shadow-xl">
          <h1 className="mb-2 text-xl font-semibold text-white">
            Stock Analysis Tool
          </h1>
          <p className="mb-4 text-sm text-zinc-400">
            Enter your access key to continue. Get it from the person who set up
            this app.
          </p>
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && validateAndSave()}
            placeholder="Access key"
            className="mb-3 w-full rounded border border-zinc-600 bg-zinc-700 px-3 py-2 text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          {error && (
            <p className="mb-3 text-sm text-red-400">{error}</p>
          )}
          <button
            type="button"
            onClick={validateAndSave}
            className="w-full rounded bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {children}
      <div className="fixed bottom-4 right-4">
        <button
          type="button"
          onClick={logout}
          className="rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600"
        >
          Change key
        </button>
      </div>
    </>
  );
}
