import { useWaHealth, type WaHealth } from '@/hooks/system';
import { formatDate } from '@/lib/format';

const TONE: Record<WaHealth['status'], { dot: string; text: string; label: string }> = {
  up:      { dot: 'bg-ok',   text: 'text-ok',   label: 'מחובר' },
  down:    { dot: 'bg-bad',  text: 'text-bad',  label: 'מנותק' },
  unknown: { dot: 'bg-soft', text: 'text-soft', label: 'לא ידוע' },
};

/** אינדיקטור קומפקטי — למסך ההגדרות ולסרגל. */
export function WaHealthBadge({ detailed = false }: { detailed?: boolean }) {
  const health = useWaHealth();
  const status = health.data?.status ?? 'unknown';
  const tone = TONE[status];

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
      <span className={tone.text}>וואטסאפ: {tone.label}</span>
      {detailed && health.data && (
        <span className="text-xs text-soft">
          {health.data.checked_at ? `· נבדק ${formatTime(health.data.checked_at)}` : '· טרם נבדק'}
          {status === 'down' && health.data.last_ok_at && ` · תקין לאחרונה ${formatDate(health.data.last_ok_at)}`}
          {status === 'down' && health.data.consecutive_failures > 0 && ` · ${health.data.consecutive_failures} כשלים רצופים`}
        </span>
      )}
    </div>
  );
}

/** באנר לדשבורד. מופיע רק כשיש בעיה. */
export function WaDownBanner() {
  const health = useWaHealth();
  if (health.data?.status !== 'down') return null;

  return (
    <div className="rounded-card border border-bad/40 bg-bad/10 p-4 text-sm" role="alert">
      <p className="font-display text-base text-bad">החיבור לוואטסאפ נפל</p>
      <p className="mt-1 text-ink">
        תזכורות הגבייה מוחזקות בתור ואינן נשלחות. הן לא אבדו — הן יצאו כשהחיבור יחזור.
      </p>
      {health.data.error && <p className="mt-1 text-xs text-soft">{health.data.error}</p>}
      {health.data.last_ok_at && (
        <p className="mt-1 text-xs text-soft">
          החיבור היה תקין לאחרונה ב-{formatDate(health.data.last_ok_at)} {formatTime(health.data.last_ok_at)}
        </p>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
}
