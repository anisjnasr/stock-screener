"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ErrorBoundary]", error);
  }, [error]);

  return (
    <div
      style={{
        padding: 32,
        fontFamily: "monospace",
        background: "#0f0f0f",
        color: "#e0e0e0",
        minHeight: "100vh",
      }}
    >
      <h2 style={{ color: "#ff5555", marginBottom: 12 }}>Client Error</h2>
      <pre
        style={{
          background: "#1c1c1c",
          padding: 16,
          borderRadius: 8,
          overflow: "auto",
          fontSize: 13,
          lineHeight: 1.5,
          maxHeight: "60vh",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {error.message}
        {"\n\n"}
        {error.stack}
      </pre>
      <button
        type="button"
        onClick={reset}
        style={{
          marginTop: 16,
          padding: "8px 20px",
          background: "#00e5cc",
          color: "#0f0f0f",
          border: "none",
          borderRadius: 6,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </div>
  );
}
