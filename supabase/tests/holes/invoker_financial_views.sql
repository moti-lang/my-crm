-- חור מכוון: מחזיר את התצוגות הכספיות להרשאות הקורא,
-- כלומר תלויות ב-RLS של students. משמש רק את בקרת השלילה.
-- מאז 0056 ה-views עצמם security_invoker, והגוף שלהם הוא פונקציית SECURITY DEFINER ב-private —
-- ולכן החור הוא להפוך את הפונקציות ל-invoker.
alter function private.v_student_balance() security invoker;
alter function private.v_branch_pnl()      security invoker;
alter function private.v_debtors()         security invoker;
