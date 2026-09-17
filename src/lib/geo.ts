/** מרחק בקילומטרים בין שתי נקודות (Haversine) */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface NavTarget {
  lat?: number | null;
  lng?: number | null;
  addressNote?: string | null;
  area?: string | null;
  name?: string | null;
}

export function addressString(t: NavTarget): string {
  return [t.addressNote, t.area].filter((s) => s && s.trim()).join(", ");
}

/** קישורי ניווט — Waze ו-Google Maps. null אם אין קואורדינטות וגם אין כתובת. */
export function navLinks(t: NavTarget): { waze: string; gmaps: string } | null {
  if (t.lat != null && t.lng != null) {
    return {
      waze: `https://waze.com/ul?ll=${t.lat},${t.lng}&navigate=yes`,
      gmaps: `https://www.google.com/maps/dir/?api=1&destination=${t.lat},${t.lng}`,
    };
  }
  const addr = addressString(t);
  if (!addr) return null;
  const q = encodeURIComponent(addr);
  return {
    waze: `https://waze.com/ul?q=${q}&navigate=yes`,
    gmaps: `https://www.google.com/maps/dir/?api=1&destination=${q}`,
  };
}

/** סידור תחנות "הגיוני": שכן-קרוב החל מהנקודה הראשונה (או ממיקום נתון) */
export function nearestNeighborOrder<T extends { lat?: number | null; lng?: number | null }>(
  items: T[],
  from?: { lat: number; lng: number } | null,
): T[] {
  const withCoords = items.filter((i) => i.lat != null && i.lng != null);
  const without = items.filter((i) => i.lat == null || i.lng == null);
  const ordered: T[] = [];
  let cur = from ?? null;
  const pool = [...withCoords];
  while (pool.length) {
    let bestIdx = 0;
    if (cur) {
      let best = Infinity;
      pool.forEach((p, idx) => {
        const d = haversineKm(cur!, { lat: p.lat!, lng: p.lng! });
        if (d < best) {
          best = d;
          bestIdx = idx;
        }
      });
    }
    const [next] = pool.splice(bestIdx, 1);
    ordered.push(next);
    cur = { lat: next.lat!, lng: next.lng! };
  }
  return [...ordered, ...without];
}
