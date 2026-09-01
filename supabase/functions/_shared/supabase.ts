import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { requireEnv } from './env.ts';

/**
 * לקוח service_role — עוקף RLS בכוונה. חי רק כאן, בצד השרת.
 * המפתח מגיע מסודות של Edge Functions, לעולם לא מהריפו.
 */
export function adminClient() {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
}
