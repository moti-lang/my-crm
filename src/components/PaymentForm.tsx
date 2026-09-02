import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAddPayment } from '@/hooks/finance';
import { formatILS } from '@/lib/format';
import { humanError } from '@/lib/errors';

const METHOD_LABEL: Record<string, string> = {
  cash: 'מזומן', transfer: 'העברה', bit: 'ביט', credit: 'אשראי', check: 'צ׳ק', other: 'אחר',
};

const schema = z.object({
  amount: z.coerce.number().positive('הסכום חייב להיות גדול מאפס'),
  paid_on: z.string().min(1, 'יש לבחור תאריך'),
  method: z.enum(['cash', 'transfer', 'bit', 'credit', 'check', 'other']),
  covers_note: z.string().optional(),
  receipt_no: z.string().optional(),
});
type Values = z.input<typeof schema>;

export function PaymentForm({
  studentId, balance, onDone, onCancel,
}: { studentId: string; balance: number; onDone: () => void; onCancel: () => void }) {
  const addPayment = useAddPayment();
  const { register, handleSubmit, watch, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      paid_on: new Date().toISOString().slice(0, 10),
      method: 'transfer',
      amount: balance > 0 ? balance : undefined,
    },
  });

  const amount = Number(watch('amount') ?? 0);
  const remaining = balance - (Number.isFinite(amount) ? amount : 0);

  return (
    <form
      className="rounded-field border border-rule p-3"
      onSubmit={handleSubmit(async (values) => {
        await addPayment.mutateAsync({
          student_id: studentId,
          amount: Number(values.amount),
          paid_on: values.paid_on,
          method: values.method,
          covers_note: values.covers_note || null,
          receipt_no: values.receipt_no || null,
        });
        onDone();
      })}
    >
      <h4 className="mb-2 text-sm font-medium">רישום תשלום</h4>

      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="סכום" error={errors.amount?.message}>
          <input type="number" step="0.01" min="0" className="field" autoFocus {...register('amount')} />
        </Field>
        <Field label="תאריך" error={errors.paid_on?.message}>
          <input type="date" className="field" {...register('paid_on')} />
        </Field>
        <Field label="אמצעי">
          <select className="field" {...register('method')}>
            {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="מספר קבלה">
          <input type="text" className="field" {...register('receipt_no')} />
        </Field>
      </div>

      <Field label="הערה (למשל: תשלום 2 מתוך 3)">
        <input type="text" className="field" {...register('covers_note')} />
      </Field>

      {amount > 0 && (
        <p className="mt-2 text-xs text-soft">
          אחרי התשלום:{' '}
          <span className={remaining > 0 ? 'text-warn' : 'text-ok'}>
            {remaining > 0 ? `נותרו ${formatILS(remaining)}` : remaining < 0 ? `יתרת זכות ${formatILS(-remaining)}` : 'שולם במלואו'}
          </span>
        </p>
      )}

      {addPayment.error != null && (
        <p className="mt-2 text-sm text-bad" role="alert">{humanError(addPayment.error)}</p>
      )}

      <div className="mt-3 flex gap-2">
        <button type="submit" className="btn-primary flex-1" disabled={addPayment.isPending}>
          {addPayment.isPending ? 'שומר…' : 'שמירה'}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={addPayment.isPending}>ביטול</button>
      </div>
    </form>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-soft">{label}</span>
      <div className="mt-1">{children}</div>
      {error && <span className="mt-0.5 block text-xs text-bad">{error}</span>}
    </label>
  );
}
