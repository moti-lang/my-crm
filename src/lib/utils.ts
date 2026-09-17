import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** שם תצוגה של ליד: שם העסק, אחרת התיאור, אחרת "ליד ללא שם" */
export function leadTitle(lead: { name?: string | null; descriptor?: string | null }): string {
  return lead.name?.trim() || lead.descriptor?.trim() || "ליד ללא שם";
}

export function truncate(s: string | null | undefined, n = 80): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
