import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'חסרים VITE_SUPABASE_URL או VITE_SUPABASE_ANON_KEY. העתיקי את .env.example ל-.env.local ומלאי אותם.',
  );
}

/**
 * מפתח anon בלבד. service_role לעולם לא מגיע לפרונט —
 * הוא חי רק כסוד של Edge Functions.
 */
export const supabase = createClient<Database>(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});
