/**
 * Startup wrapper that verifies the environment before handing off to Next.js.
 * Ensures any crash produces visible log output.
 */
import { spawn } from "child_process";
import { existsSync, readdirSync } from "fs";
import { join } from "path";

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
  process.exit(1);
});

console.log("[boot] Node", process.version, "| CWD:", process.cwd(), "| PORT:", process.env.PORT || "3000");

// Check better-sqlite3 native bindings
try {
  const Database = (await import("better-sqlite3")).default;
  console.log("[boot] better-sqlite3 OK");
} catch (e) {
  console.error("[boot] better-sqlite3 FAILED:", e.message);
}

// Check data directory
const dataDir = join(process.cwd(), "data");
if (existsSync(dataDir)) {
  const files = readdirSync(dataDir).filter(f => !f.startsWith(".")).slice(0, 15);
  console.log("[boot] data/:", files.join(", "));
} else {
  console.warn("[boot] data/ NOT FOUND at", dataDir);
}

// Hand off to next start
console.log("[boot] Launching next start...");
const child = spawn("npx", ["next", "start"], {
  stdio: "inherit",
  env: process.env,
  shell: true,
});

child.on("error", (err) => {
  console.error("[boot] Failed to start Next.js:", err);
  process.exit(1);
});

child.on("exit", (code) => {
  console.log("[boot] Next.js exited with code", code);
  process.exit(code ?? 1);
});
