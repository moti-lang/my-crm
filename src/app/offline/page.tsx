import Link from "next/link";

export const metadata = { title: "אין חיבור" };

export default function OfflinePage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-5xl">📵</div>
      <h1 className="text-2xl font-bold">אין חיבור לרשת</h1>
      <p className="text-muted-foreground">
        הדף הזה לא נשמר במכשיר. לידים שתוסיף במסך ההוספה המהירה נשמרים מקומית ומסתנכרנים אוטומטית כשהחיבור חוזר.
      </p>
      <Link href="/leads/new" className="rounded-xl bg-primary px-5 py-3 font-medium text-primary-foreground">
        + הוספה מהירה
      </Link>
      <Link href="/" className="text-primary underline">
        נסה שוב
      </Link>
    </div>
  );
}
