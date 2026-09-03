import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ImportRow } from '@/lib/import-core';

const CHUNK = 50;

/**
 * הכנסת השורות התקינות, במנות. שורה שנדחתה במסד (RLS, אילוץ) חוזרת
 * כשגיאה עם מספר השורה — לא נבלעת.
 */
export function useImportStudents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { seasonId: string; rows: { line: number; row: ImportRow }[] }) => {
      const inserted: number[] = [];
      const failed: { line: number; message: string }[] = [];
      for (let i = 0; i < input.rows.length; i += CHUNK) {
        const batch = input.rows.slice(i, i + CHUNK);
        const payload = batch.map(({ row }) => {
          const { branch_name: _branch, ...rest } = row;
          return { ...rest, season_id: input.seasonId };
        });
        const { error } = await supabase.from('students').insert(payload);
        if (!error) { inserted.push(...batch.map((b) => b.line)); continue; }
        // המנה נדחתה — מנסים אחת-אחת כדי לדעת איזו שורה.
        for (const item of batch) {
          const { branch_name: _b, ...rest } = item.row;
          const { error: one } = await supabase.from('students').insert({ ...rest, season_id: input.seasonId });
          if (one) failed.push({ line: item.line, message: one.message });
          else inserted.push(item.line);
        }
      }
      return { inserted, failed };
    },
    onSuccess: async () => {
      await Promise.all([['students'], ['student-balances'], ['branch-pnl'], ['debtors']]
        .map((k) => qc.invalidateQueries({ queryKey: k })));
    },
  });
}
