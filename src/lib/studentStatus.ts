import type { Enums } from './database.types';

// כאן (ולא ב-hooks) כדי שגם קוד טהור — הייצוא ובדיקותיו ב-Node — ישתמש באותן תוויות.
export type StudentStatus = Enums<'student_status'>;

export const STATUS_LABEL: Record<StudentStatus, string> = {
  active: 'פעילה',
  pending: 'ממתינה',
  stopped: 'הפסיקה',
  graduated: 'סיימה',
};

export const STATUS_TONE: Record<StudentStatus, string> = {
  active: 'bg-ok/15 text-ok',
  pending: 'bg-warn/15 text-warn',
  stopped: 'bg-bad/15 text-bad',
  graduated: 'bg-shade text-soft',
};
