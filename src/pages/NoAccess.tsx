/**
 * מסך "אין לך הרשאה". מגיעות לכאן שתי אוכלוסיות:
 *   · חשבון גוגל שאינו ברשימת המורשים — המסד דחה את יצירת החשבון,
 *     ואין session בכלל (denied).
 *   · חשבון שנכנס בעבר והוסר או הושבת — יש session, אין פרופיל פעיל.
 * בשני המקרים ה-RLS כבר סגר את הדלת; המסך רק אומר את זה בעברית.
 */
export function NoAccess({ email, onSignOut }: { email?: string | null; onSignOut: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="card w-full max-w-sm p-6 text-center shadow-pop" role="alert">
        <p className="font-display text-xl text-ink">אין לך הרשאה</p>
        <p className="mt-2 text-sm text-soft">
          {email ? (
            <>
              החשבון <span dir="ltr" className="font-medium text-ink">{email}</span> אינו ברשימת המורשים של המערכת.
            </>
          ) : (
            'חשבון הגוגל הזה אינו ברשימת המורשים של המערכת.'
          )}
        </p>
        <p className="mt-1 text-sm text-soft">
          כדי להיכנס, הבעלים צריכה להזמין את האימייל הזה במסך המשתמשים.
        </p>
        <button type="button" className="btn-ghost mt-6 w-full" onClick={onSignOut}>
          כניסה עם חשבון אחר
        </button>
      </div>
    </div>
  );
}
