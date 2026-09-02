-- חור מכוון: מחזיר את התצוגות הכספיות ל-security_invoker,
-- כלומר תלויות ב-RLS של students. משמש רק את בקרת השלילה.
alter view v_student_balance set (security_invoker = true);
alter view v_branch_pnl      set (security_invoker = true);
alter view v_debtors         set (security_invoker = true);
