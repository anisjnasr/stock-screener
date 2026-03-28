"use client";

import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import { useProfile } from "@/contexts/ProfileContext";

export default function ProfileModal() {
  const { profile, modalOpen, setModalOpen, login, logout, configured } = useProfile();
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState(["", "", "", ""]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const pinRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (modalOpen) {
      setError("");
      if (!profile) {
        setUsername("");
        setPin(["", "", "", ""]);
        setTimeout(() => nameRef.current?.focus(), 50);
      }
    }
  }, [modalOpen, profile]);

  if (!modalOpen) return null;

  const pinStr = pin.join("");

  const handlePinChange = (i: number, value: string) => {
    if (value.length > 1) value = value.slice(-1);
    if (value && !/^\d$/.test(value)) return;
    const next = [...pin];
    next[i] = value;
    setPin(next);
    if (value && i < 3) pinRefs[i + 1].current?.focus();
  };

  const handlePinKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !pin[i] && i > 0) {
      pinRefs[i - 1].current?.focus();
    }
    if (e.key === "Enter" && pinStr.length === 4 && username.trim()) {
      handleSubmit();
    }
  };

  const handlePinPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
    if (text.length === 4) {
      e.preventDefault();
      setPin(text.split(""));
      pinRefs[3].current?.focus();
    }
  };

  const handleSubmit = async () => {
    if (!username.trim()) { setError("Enter your name"); return; }
    if (pinStr.length !== 4) { setError("Enter a 4-digit PIN"); return; }
    setSubmitting(true);
    setError("");
    const result = await login(username.trim(), pinStr);
    setSubmitting(false);
    if (result.ok) {
      setModalOpen(false);
      window.location.reload();
    } else {
      setError(result.error);
    }
  };

  const handleLogout = () => {
    logout();
    setUsername("");
    setPin(["", "", "", ""]);
    setModalOpen(false);
    window.location.reload();
  };

  if (!configured) {
    return (
      <div
        ref={backdropRef}
        className="fixed inset-0 z-[9999] flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
        onClick={(e) => { if (e.target === backdropRef.current) setModalOpen(false); }}
      >
        <div
          className="rounded-xl p-6 w-[360px] shadow-2xl"
          style={{ background: "var(--ws-bg2)", border: "1px solid var(--ws-border-hover)" }}
        >
          <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--ws-text)" }}>Profile Sync</h2>
          <p className="text-xs mb-4" style={{ color: "var(--ws-text-dim)" }}>
            Supabase is not configured. Add <code className="font-mono" style={{ color: "var(--ws-cyan)" }}>NEXT_PUBLIC_SUPABASE_URL</code> and <code className="font-mono" style={{ color: "var(--ws-cyan)" }}>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to your environment to enable cloud sync.
          </p>
          <button
            type="button"
            onClick={() => setModalOpen(false)}
            className="w-full py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors"
            style={{ background: "var(--ws-bg3)", color: "var(--ws-text-dim)", border: "1px solid var(--ws-border)" }}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === backdropRef.current) setModalOpen(false); }}
    >
      <div
        className="rounded-xl p-6 w-[360px] shadow-2xl"
        style={{ background: "var(--ws-bg2)", border: "1px solid var(--ws-border-hover)" }}
      >
        {profile ? (
          <>
            <div className="flex items-center gap-3 mb-5">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold uppercase shrink-0"
                style={{ background: "rgba(0,229,204,0.15)", color: "var(--ws-cyan)" }}
              >
                {profile.username.charAt(0)}
              </div>
              <div>
                <div className="text-sm font-semibold capitalize" style={{ color: "var(--ws-text)" }}>
                  {profile.username}
                </div>
                <div className="text-[11px]" style={{ color: "var(--ws-text-dim)" }}>
                  Synced across devices
                </div>
              </div>
            </div>
            <div className="text-[11px] mb-4 px-3 py-2 rounded-lg" style={{ background: "var(--ws-bg3)", color: "var(--ws-text-dim)" }}>
              Your watchlists, scans, flags, and settings are saved to the cloud and will be available on any device you log into.
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="flex-1 py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors"
                style={{ background: "var(--ws-bg3)", color: "var(--ws-text-dim)", border: "1px solid var(--ws-border)" }}
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="flex-1 py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors"
                style={{ background: "rgba(255,77,106,0.1)", color: "var(--ws-red)", border: "1px solid rgba(255,77,106,0.25)" }}
              >
                Sign Out
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-sm font-semibold mb-1" style={{ color: "var(--ws-text)" }}>
              Sign In
            </h2>
            <p className="text-[11px] mb-5" style={{ color: "var(--ws-text-dim)" }}>
              Enter your name and a 4-digit PIN to sync your data across devices. New profiles are created automatically.
            </p>

            <label className="block text-[11px] font-medium mb-1.5 uppercase tracking-wider" style={{ color: "var(--ws-text-dim)" }}>
              Name
            </label>
            <input
              ref={nameRef}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") pinRefs[0].current?.focus(); }}
              placeholder="e.g. Anis"
              className="w-full rounded-lg px-3 py-2 text-sm mb-4 outline-none"
              style={{
                background: "var(--ws-bg3)",
                color: "var(--ws-text)",
                border: "1px solid var(--ws-border-hover)",
              }}
              autoComplete="off"
            />

            <label className="block text-[11px] font-medium mb-1.5 uppercase tracking-wider" style={{ color: "var(--ws-text-dim)" }}>
              4-Digit PIN
            </label>
            <div className="flex gap-2 mb-5" onPaste={handlePinPaste}>
              {pin.map((d, i) => (
                <input
                  key={i}
                  ref={pinRefs[i]}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={d}
                  onChange={(e) => handlePinChange(i, e.target.value)}
                  onKeyDown={(e) => handlePinKeyDown(i, e)}
                  className="w-12 h-12 text-center text-lg font-mono rounded-lg outline-none transition-colors"
                  style={{
                    background: "var(--ws-bg3)",
                    color: "var(--ws-text)",
                    border: d ? "1px solid var(--ws-cyan)" : "1px solid var(--ws-border-hover)",
                    caretColor: "var(--ws-cyan)",
                  }}
                  onFocus={(e) => e.target.select()}
                />
              ))}
            </div>

            {error && (
              <div className="text-[11px] mb-3 px-3 py-2 rounded-lg" style={{ background: "rgba(255,77,106,0.08)", color: "var(--ws-red)" }}>
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-2.5 rounded-lg text-xs font-semibold uppercase tracking-wider cursor-pointer transition-all"
              style={{
                background: submitting ? "rgba(0,229,204,0.08)" : "rgba(0,229,204,0.15)",
                color: "var(--ws-cyan)",
                border: "1px solid rgba(0,229,204,0.3)",
                opacity: submitting ? 0.6 : 1,
              }}
              onMouseEnter={(e) => { if (!submitting) e.currentTarget.style.background = "rgba(0,229,204,0.25)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = submitting ? "rgba(0,229,204,0.08)" : "rgba(0,229,204,0.15)"; }}
            >
              {submitting ? "Signing in…" : "Sign In"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
