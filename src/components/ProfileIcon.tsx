"use client";

import { useProfile } from "@/contexts/ProfileContext";

export default function ProfileIcon() {
  const { profile, setModalOpen } = useProfile();

  return (
    <button
      type="button"
      onClick={() => setModalOpen(true)}
      className="shrink-0 flex items-center justify-center rounded-full cursor-pointer transition-all"
      style={{
        width: 28,
        height: 28,
        background: profile ? "rgba(0,229,204,0.15)" : "var(--ws-bg3)",
        border: profile ? "1px solid rgba(0,229,204,0.3)" : "1px solid var(--ws-border-hover)",
        color: profile ? "var(--ws-cyan)" : "var(--ws-text-dim)",
      }}
      title={profile ? profile.username : "Sign in"}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = profile ? "rgba(0,229,204,0.25)" : "rgba(255,255,255,0.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = profile ? "rgba(0,229,204,0.15)" : "var(--ws-bg3)";
      }}
    >
      {profile ? (
        <span className="text-[11px] font-bold uppercase leading-none">
          {profile.username.charAt(0)}
        </span>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width={14} height={14}>
          <path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 00-13.074.003z" />
        </svg>
      )}
    </button>
  );
}
