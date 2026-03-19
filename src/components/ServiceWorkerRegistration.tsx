"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          // Periodic cache cleanup every 30 minutes
          setInterval(() => {
            reg.active?.postMessage("cleanup-cache");
          }, 30 * 60 * 1000);
        })
        .catch(() => {
          // SW registration failed -- app works fine without it
        });
    }
  }, []);

  return null;
}
