import { humanError } from '@/lib/errors';
import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * גבול שגיאות. בלעדיו שגיאת render אחת מותירה מסך לבן —
 * בלי הודעה, בלי דרך לצאת, ובלי שהמשתמשת תדע שיש בכלל בעיה.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-4">
        <div className="card w-full max-w-md p-6 text-center">
          <h1 className="font-display text-xl text-bad">משהו השתבש</h1>
          <p className="mt-2 text-sm text-soft">
            אירעה תקלה בהצגת המסך. הנתונים לא נפגעו.
          </p>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              className="btn-primary flex-1"
              onClick={() => window.location.reload()}
            >
              רענון הדף
            </button>
            <a className="btn-ghost" href="/">חזרה לדשבורד</a>
          </div>
          <details className="mt-4 text-right">
            <summary className="cursor-pointer text-xs text-soft">פרטים טכניים</summary>
            <pre className="mt-2 overflow-x-auto rounded-field bg-shade p-2 text-left text-xs" dir="ltr">
              {humanError(this.state.error)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}

/** מסך הגדרה חסרה — נפרד, כי הפתרון שלו אחר לגמרי. */
export function ConfigError({ detail }: { detail: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="card w-full max-w-md p-6">
        <h1 className="font-display text-xl text-bad">המערכת אינה מוגדרת</h1>
        <p className="mt-2 text-sm text-ink">{detail}</p>
        <p className="mt-3 text-sm text-soft">
          זו תקלת הגדרה ולא תקלה בנתונים. יש להגדיר את משתני הסביבה
          בפריסה ולפרוס מחדש.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-field bg-shade p-3 text-xs" dir="ltr">
{`VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>`}
        </pre>
      </div>
    </div>
  );
}
