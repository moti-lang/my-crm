"use client";

import { get, set } from "idb-keyval";
import { ApiError, OfflineError, api } from "./api";

const KEY = "sevev-lead-queue";
const FAILED_KEY = "sevev-lead-queue-failed";
export const QUEUE_EVENT = "sevev-queue-changed";

export interface QueuedLead {
  id: string;
  payload: unknown;
  createdAt: string;
  title: string;
}

async function read(key = KEY): Promise<QueuedLead[]> {
  try {
    return ((await get(key)) as QueuedLead[] | undefined) ?? [];
  } catch {
    return [];
  }
}
async function write(items: QueuedLead[], key = KEY) {
  await set(key, items);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(QUEUE_EVENT));
}

export async function enqueueLead(payload: unknown, title: string): Promise<QueuedLead> {
  const item: QueuedLead = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, payload, createdAt: new Date().toISOString(), title };
  const items = await read();
  items.push(item);
  await write(items);
  return item;
}

export async function queuedCount(): Promise<number> {
  return (await read()).length;
}
export async function listQueued(): Promise<QueuedLead[]> {
  return read();
}
export async function listFailed(): Promise<QueuedLead[]> {
  return read(FAILED_KEY);
}
export async function removeQueued(id: string) {
  await write((await read()).filter((i) => i.id !== id));
}
export async function removeFailed(id: string) {
  await write((await read(FAILED_KEY)).filter((i) => i.id !== id), FAILED_KEY);
}

let flushing = false;
/** שולח את התור לשרת. עוצר בניתוק רשת; פריטים שנדחו (400) עוברים לרשימת "נכשלו". */
export async function flushQueue(): Promise<{ synced: number; failed: number; remaining: number }> {
  if (flushing) return { synced: 0, failed: 0, remaining: (await read()).length };
  flushing = true;
  let synced = 0;
  let failed = 0;
  try {
    let items = await read();
    for (const item of [...items]) {
      try {
        await api("/api/leads", { method: "POST", body: item.payload });
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
