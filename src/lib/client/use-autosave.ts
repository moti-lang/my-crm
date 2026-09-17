"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, OfflineError } from "./api";
import { enqueueRequest } from "./offline-queue";
import { createAutosave, type Autosave, type SaveState } from "./autosave";

/** שמירה אוטומטית של PATCH לנתיב נתון, עם תור אופליין משותף */
export function useAutosave<P extends object>(opts: { path: string; title: string; coalesceKey?: string; delay?: number; onSaved?: (patch: P, result: unknown) => void }) {
  const [state, setState] = useState<SaveState>({ status: "idle" });
  const onSavedRef = useRef(opts.onSaved);
  onSavedRef.current = opts.onSaved;

  const controller = useMemo<Autosave<P>>(
    () =>
      createAutosave<P>({
        delay: opts.delay,
        request: (patch) => api(opts.path, { method: "PATCH", body: patch }),
        enqueue: (patch) => enqueueRequest({ method: "PATCH", path: opts.path, body: patch, title: opts.title, coalesceKey: opts.coalesceKey ?? opts.path }),
        isOffline: (e) => e instanceof OfflineError,
        onSaved: (patch, result) => onSavedRef.current?.(patch, result),
        onState: setState,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts.path],
  );

  useEffect(() => {
    const flushNow = () => void controller.flush();
    window.addEventListener("pagehide", flushNow);
    return () => {
      window.removeEventListener("pagehide", flushNow);
      void controller.flush();
      controller.dispose();
    };
  }, [controller]);

  return { state, save: controller.save, flush: controller.flush, retry: controller.retry };
}
