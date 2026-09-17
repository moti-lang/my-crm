import Link from "next/link";
import { isAuthConfigured, isAuthDisabled } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "כניסה" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <div className="text-center">
        <div className="text-5xl">🚶</div>
        <h1 className="mt-2 text-3xl font-bold">סבב</h1>
        <p className="text-muted-foreground">מעקב לידים בשטח</p>
      </div>
      {isAuthDisabled() ? (
        <p className="rounded-xl bg-muted p-4 text-center text-sm">
          מסך הכניסה כבוי (AUTH_DISABLED). <Link className="text-primary underline" href="/">המשך</Link>
        </p>
      ) : !isAuthConfigured() ? (
        <p className="rounded-xl border border-warning/50 bg-warning/10 p-4 text-sm leading-relaxed">
          לא הוגדרה סיסמה. יש להגדיר את משתני הסביבה <code dir="ltr">APP_PASSWORD</code> ו-<code dir="ltr">AUTH_SECRET</code> (ראה README).
        </p>
      ) : (
        <LoginForm next={next} />
      )}
    </div>
  );
}
