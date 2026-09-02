import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * שגיאת הגדרה מוחזרת כערך ולא נזרקת.
 *
 * זריקה ברמת המודול עוצרת את הטעינה כולה, והתוצאה היא מסך לבן עם
 * שגיאה בקונסול בלבד. משתנה סביבה שנשכח בנטליפיי היה נראה כמו
 * מערכת שבורה, בלי שום רמז מה לעשות. App.tsx מציג את זה כמסך קריא.
 */
export const supabaseConfigError: string | null =
  !url || url.includes('placeholder')
    ? 'חסר VITE_SUPABASE_URL'
    : !anonKey || anonKey.includes('placeholder')
      ? 'חסר VITE_SUPABASE_ANON_KEY'
      : null;

/**
 * מפתח anon בלבד. service_role לעולם לא מגיע לפרונט —
 * הוא חי רק כסוד של Edge Functions.
 */
export const supabase = createClient<Database>(
  url || 'https://unconfigured.invalid',
  anonKey || 'unconfigured',
  { auth: { persistSession: true, autoRefreshToken: true } },
);
