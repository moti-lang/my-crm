"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { fieldClass, Select } from "@/components/ui/input";

interface InlineTextProps {
  value: string | null | undefined;
  /** תצוגה שונה מהערך הנערך (למשל טלפון מעוצב) */
  displayValue?: string;
  placeholder: string;
  /** נקרא בכל הקשה — לשמירה עם debounce */
  onChange: (v: string) => void;
  /** נקרא ביציאה מהשדה — לשמירה מיידית */
  onCommit: (v: string) => void;
  multiline?: boolean;
  type?: "text" | "tel" | "email" | "url";
  ltr?: boolean;
  label?: string;
  icon?: string;
  className?: string;
  textClassName?: string;
  big?: boolean;
}

/** ערך שנראה כטקסט; לחיצה הופכת אותו לשדה קלט, יציאה שומרת. */
export function InlineText({ value, displayValue, placeholder, onChange, onCommit, multiline, type = "text", ltr, label, icon, className, textClassName, big }: InlineTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const original = useRef(value ?? "");
  const finished = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  function start() {
    original.current = value ?? "";
    setDraft(value ?? "");
    finished.current = false;
    setEditing(true);
  }
  function finish() {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    if (draft !== original.current) onCommit(draft);
  }

  if (editing) {
    const common = {
      autoFocus: true,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setDraft(e.target.value);
        onChange(e.target.value);
      },
      onBlur: finish,
      dir: ltr ? ("ltr" as const) : undefined,
      "aria-label": label ?? placeholder,
      className: cn(fieldClass, ltr && "text-start", big && "text-lg", multiline && "min-h-32 leading-relaxed", className),
    };
    return multiline ? (
      <textarea {...common} rows={4} onKeyDown={(e) => e.key === "Escape" && finish()} />
    ) : (
      <input
        {...common}
        type={type}
        inputMode={type === "tel" ? "tel" : type === "email" ? "email" : type === "url" ? "url" : undefined}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    );
  }

  const empty = !value?.trim();
  return (
    <button
      type="button"
      onClick={start}
      title="לחץ לעריכה"
      className={cn(
        "-mx-2 flex min-h-11 w-[calc(100%+1rem)] items-start gap-1 rounded-lg px-2 py-2 text-start transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        multiline && "whitespace-pre-wrap",
        className,
      )}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {label && <span className="shrink-0 text-sm text-muted-foreground">{label}:</span>}
      <span dir={ltr && !empty ? "ltr" : undefined} className={cn("min-w-0 flex-1 break-words", empty ? "text-muted-foreground" : "", big && "text-lg leading-relaxed", textClassName)}>
        {empty ? placeholder : (displayValue ?? value)}
      </span>
    </button>
  );
}

export function InlineSelect<T extends string>({ value, options, onChange, label, className }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label?: string; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-0.5", className)}>
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
      <Select value={value} onChange={(e) => onChange(e.target.value as T)} className="min-h-10 py-1">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </label>
  );
}
