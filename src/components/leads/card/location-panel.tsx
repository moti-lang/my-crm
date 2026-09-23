"use client";

import { useState } from "react";
import { ExternalLink, LocateFixed, Navigation, Trash2 } from "lucide-react";
import { AnchorButton, Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { navLinks } from "@/lib/geo";

/**
 * מיקום הליד: מפה קטנה (OpenStreetMap, בלי מפתח), פתיחת הסיכה במפות, עדכון למיקום הנוכחי וניקוי.
 * השמירה עוברת דרך onChange (השמירה האוטומטית של הכרטיס).
 */
export function LocationPanel({
  lat,
  lng,
  area,
  addressNote,
  onChange,
}: {
  lat: number | null;
  lng: number | null;
  area: string | null;
  addressNote: string | null;
  onChange: (lat: number | null, lng: number | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const has = lat != null && lng != null;
  const links = navLinks({ lat, lng, area, addressNote });

  function locate() {
    if (!navigator.geolocation) {
      setError("אין GPS במכשיר או שהדפדפן חוסם גישה למיקום");
      return;
    }
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        setAccuracy(Math.round(pos.coords.accuracy));
        onChange(Number(pos.coords.latitude.toFixed(6)), Number(pos.coords.longitude.toFixed(6)));
      },
      (err) => {
        setBusy(false);
        setError(err.code === err.PERMISSION_DENIED ? "הגישה למיקום נחסמה — אפשר לאשר בהגדרות הדפדפן" : "לא הצלחתי לאתר מיקום, נסה שוב בחוץ");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 },
    );
  }

  const bbox = has ? [lng! - 0.004, lat! - 0.0025, lng! + 0.004, lat! + 0.0025].map((n) => n.toFixed(5)).join(",") : "";
  const embed = has ? `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}` : "";
  const pin = has ? `https://www.google.com/maps?q=${lat},${lng}` : "";

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="font-bold">📍 מיקום</div>
        {has && (
          <a href={pin} target="_blank" rel="noopener" className="flex min-h-9 items-center gap-1 text-sm text-primary underline">
            <ExternalLink className="h-4 w-4" /> פתח במפה
          </a>
        )}
      </div>
      {has ? (
        <>
          <a href={pin} target="_blank" rel="noopener" className="mt-2 block overflow-hidden rounded-xl border border-border" title="פתח במפה">
            <iframe title="מפת המיקום השמור" src={embed} className="pointer-events-none h-48 w-full bg-muted" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
          </a>
          <div className="mt-1 text-xs text-muted-foreground" dir="ltr">
            {lat!.toFixed(5)}, {lng!.toFixed(5)}
            {accuracy != null && ` · ±${accuracy}m`}
          </div>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">
          אין מיקום GPS שמור.{area || addressNote ? " הניווט יעבוד לפי הכתובת." : ""} עמוד ליד הכניסה ולחץ &quot;שמור מיקום נוכחי&quot;.
        </p>
      )}
      <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto">
        <Button variant="outline" size="sm" onClick={locate} disabled={busy}>
          <LocateFixed className={busy ? "h-4 w-4 animate-pulse" : "h-4 w-4"} /> {busy ? "מאתר…" : has ? "עדכן למיקום הנוכחי" : "שמור מיקום נוכחי"}
        </Button>
        {links && (
          <AnchorButton href={links.waze} target="_blank" rel="noopener" variant="outline" size="sm">
            <Navigation className="h-4 w-4" /> Waze
          </AnchorButton>
        )}
        {has && (
          <Button
            variant="ghost"
            size="sm"
            className="text-danger"
            onClick={() => {
              if (window.confirm("למחוק את המיקום השמור?")) {
                setAccuracy(null);
                onChange(null, null);
              }
            }}
          >
            <Trash2 className="h-4 w-4" /> נקה
          </Button>
        )}
      </div>
      {error && <div className="mt-1 text-sm text-danger">{error}</div>}
    </Card>
  );
}
