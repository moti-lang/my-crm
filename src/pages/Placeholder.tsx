/**
 * מסכים שנבנים בסבבים הבאים. המסלול קיים והניווט עובד,
 * כדי שהשלד יהיה שלם ולא ייווצרו קישורים שבורים.
 */
export function Placeholder({ title, round }: { title: string; round: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl">{title}</h1>
      <div className="card p-8 text-center">
        <p className="font-display text-lg text-ink">המסך הזה נבנה ב{round}</p>
        <p className="mt-1 text-sm text-soft">הנתונים והטבלאות כבר קיימים במסד — נותר לחבר את הממשק.</p>
      </div>
    </div>
  );
}
