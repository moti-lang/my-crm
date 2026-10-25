"use client";

import { useEffect } from "react";

export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production" && !window.location.search.includes("sw=1")) return;
    let refreshing = false;
    const onControllerChange = () => {
      // גרסה חדשה של האפליקציה נכנסה לפעולה — טוענים מחדש פעם אחת כדי שלא יישארו קבצים ישנים
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    let reg: ServiceWorkerRegistration | undefined;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((r) => {
        reg = r;
        r.update().catch(() => undefined);
      })
      .catch((e) => console.warn("SW register failed", e));
    const onVisible = () => {
      if (document.visibilityState === "visible") reg?.update().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
