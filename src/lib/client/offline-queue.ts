"use client";

import { get, set } from "idb-keyval";
import { ApiError, OfflineError, api } from "./api";

/**
 * תור סנכרון אופליין — משותף להוספה מהירה ולעריכות בכרטיס.
 * כל פריט הוא בקשת HTTP שתישלח לפי הסדר כשחוזר חיבור. עריכות (PATCH) לאותו יעד מתמזגות לפריט אחד.
 */
const KEY = "sevev-lead-queue";
const FAILED_KEY = "sevev-lead-queue-failed";
export const QUEUE_EVENT = "sevev-queue-changed";

export interface QueuedRequest {
  id: string;
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  title: string;
  createdAt: string;
  /** מפתח מיזוג: PATCH-ים לאותו מפתח מתמזגים (הערך החדש גובר) */
  coalesceKey?: string;
}
/** תאימות לאחור לשם הישן */
export type QueuedLead = QueuedRequest;

interface LegacyItem {
  id: string;
  payload: unknown;
  createdAt: string;
  title: string;
}

function normalize(item: QueuedRequest | LegacyItem): QueuedRequest {
  if ("path" in item && item.path) return item as QueuedRequest;
  const legacy = item as LegacyItem;
  return { id: legacy.id, method: "POST", path: "/api/leads", body: legacy.payload, title: legacy.title, createdAt: legacy.createdAt };
}

async function read(key = KEY): Promise<QueuedRequest[]> {
  try {
    const items = ((await get(key)) as Array<QueuedRequest | LegacyItem> | undefined) ?? [];
    return items.map(normalize);
  } catch {
    return [];
  }
}
async function write(items: QueuedRequest[], key = KEY) {
  await set(key, items);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(QUEUE_EVENT));
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** הוספת בקשה לתור. PATCH עם coalesceKey קיים מתמזג לתוך הפריט הקיים. */
export async function enqueueRequest(req: Omit<QueuedRequest, "id" | "createdAt">): Promise<QueuedRequest> {
  const items = await read();
  if (req.method === "PATCH" && req.coalesceKey) {
    const existing = items.find((i) => i.method === "PATCH" && i.coalesceKey === req.coalesceKey);
    if (existing) {
      existing.body = { ...(existing.body as object), ...(req.body as object) };
      existing.title = req.title;
      await write(items);
      return existing;
    }
  }
  const item: QueuedRequest = { ...req, id: newId(), createdAt: new Date().toISOString() };
  items.push(item);
  await write(items);
  return item;
}

export async function enqueueLead(payload: unknown, title: string): Promise<QueuedRequest> {
  return enqueueRequest({ method: "POST", path: "/api/leads", body: payload, title });
}

export async function queuedCount(): Promise<number> {
  return (await read()).length;
}
export async function listQueued(): Promise<QueuedRequest[]> {
  return read();
}
export async function listFailed(): Promise<QueuedRequest[]> {
  return read(FAILED_KEY);
}
export async function removeQueued(id: string) {
  await write((await read()).filter((i) => i.id !== id));
}
export async function removeFailed(id: string) {
  await write((await read(FAILED_KEY)).filter((i) => i.id !== id), FAILED_KEY);
}

/** מבצע בקשה; בניתוק רשת מכניס אותה לתור ומחזיר queued=true */
export async function requestOrQueue<T = unknown>(req: Omit<QueuedRequest, "id" | "createdAt">): Promise<{ queued: boolean; result?: T }> {
  try {
    const result = await api<T>(req.path, { method: req.method, body: req.body });
    return { queued: false, result };
  } catch (e) {
    if (e instanceof OfflineError) {
      await enqueueRequest(req);
      return { queued: true };
    }
    throw e;
  }
}

let flushing = false;
/** שולח את התור לשרת לפי הסדר. עוצר בניתוק רשת; פריטים שנדחו (4xx) עוברים לרשימת "נכשלו". */
export async function flushQueue(): Promise<{ synced: number; failed: number; remaining: number }> {
  if (flushing) return { synced: 0, failed: 0, remaining: (await read()).length };
  flushing = true;
  let synced = 0;
  let failed = 0;
  try {
    let items = await read();
    for (const item of [...items]) {
      try {
        await api(item.path, { method: item.method, body: item.body });
        items = items.filter((i) => i.id !== item.id);
        await write(items);
        synced++;
      } catch (e) {
        if (e instanceof OfflineError) break;
        if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401) {
          items = items.filter((i) => i.id !== item.id);
          await write(items);
          const f = await read(FAILED_KEY);
          f.push({ ...item, title: `${item.title} — ${e.message}` });
          await write(f, FAILED_KEY);
          failed++;
          continue;
        }
        break;
      }
    }
    return { synced, failed, remaining: items.length };
  } finally {
    flushing = false;
  }
}
