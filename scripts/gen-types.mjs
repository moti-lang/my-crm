#!/usr/bin/env node
// מחולל src/lib/database.types.ts מהקטלוג של פוסטגרס.
// עוקף את הצורך ב-`supabase gen types` (שדורש דוקר) בזמן פיתוח מקומי.
// מול פרויקט Supabase חי אפשר להשתמש ב-`npm run gen:types` הרשמי במקום.
let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  const { enums, relations } = JSON.parse(raw);
  const enumNames = new Set(enums.map((e) => e.name));

  const tsType = (pg) => {
    const arr = pg.endsWith('[]');
    const base = arr ? pg.slice(0, -2) : pg;
    let t;
    if (enumNames.has(base)) t = `Database["public"]["Enums"]["${base}"]`;
    else if (/^(uuid|text|character varying|character|date|time.*|interval|name)$/.test(base)) t = 'string';
    else if (/^(numeric|integer|bigint|smallint|real|double precision)$/.test(base)) t = 'number';
    else if (base === 'boolean') t = 'boolean';
    else if (/^json/.test(base)) t = 'Json';
    else t = 'unknown';
    return arr ? `${t}[]` : t;
  };

  const out = [];
  out.push('// נוצר אוטומטית ע"י scripts/gen-types.mjs — אל תערוך ידנית.');
  out.push('// לרענון: npm run gen:types:local (מקומי) או npm run gen:types (מול Supabase).');
  out.push('');
  out.push('export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];');
  out.push('');
  out.push('export type Database = {');
  out.push('  public: {');

  const emit = (rels, withWrites) => {
    for (const r of rels) {
      out.push(`      ${r.name}: {`);
      out.push('        Row: {');
      for (const c of r.columns) out.push(`          ${c.name}: ${tsType(c.type)}${c.nullable ? ' | null' : ''};`);
      out.push('        };');
      if (withWrites) {
        out.push('        Insert: {');
        for (const c of r.columns) {
          const opt = c.nullable || c.hasDefault ? '?' : '';
          out.push(`          ${c.name}${opt}: ${tsType(c.type)}${c.nullable ? ' | null' : ''};`);
        }
        out.push('        };');
        out.push('        Update: {');
        for (const c of r.columns) out.push(`          ${c.name}?: ${tsType(c.type)}${c.nullable ? ' | null' : ''};`);
        out.push('        };');
      }
      const rels_ = r.relationships ?? [];
      if (rels_.length === 0) {
        out.push('        Relationships: [];');
      } else {
        out.push('        Relationships: [');
        for (const fk of rels_) {
          out.push('          {');
          out.push(`            foreignKeyName: ${JSON.stringify(fk.foreignKeyName)};`);
          out.push(`            columns: [${fk.columns.map((c) => JSON.stringify(c)).join(', ')}];`);
          out.push(`            isOneToOne: ${fk.isOneToOne};`);
          out.push(`            referencedRelation: ${JSON.stringify(fk.referencedRelation)};`);
          out.push(`            referencedColumns: [${fk.referencedColumns.map((c) => JSON.stringify(c)).join(', ')}];`);
          out.push('          },');
        }
        out.push('        ];');
      }
      out.push('      };');
    }
  };

  out.push('    Tables: {');
  emit(relations.filter((r) => r.kind === 'table'), true);
  out.push('    };');
  out.push('    Views: {');
  emit(relations.filter((r) => r.kind === 'view'), false);
  out.push('    };');
  out.push('    Enums: {');
  for (const e of enums) out.push(`      ${e.name}: ${e.values.map((v) => JSON.stringify(v)).join(' | ')};`);
  out.push('    };');
  // supabase-js דורש את שני המפתחות האלה כדי שהסכמה תעמוד ב-GenericSchema.
  // בלעדיהם כל שאילתה מוחזרת כ-never. טיפוסי RPC ייווצרו בסבב שיציג אותם.
  out.push('    Functions: { [_ in never]: never };');
  out.push('    CompositeTypes: { [_ in never]: never };');
  out.push('  };');
  out.push('};');
  out.push('');
  out.push('export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];');
  out.push('export type Views<T extends keyof Database["public"]["Views"]> = Database["public"]["Views"][T]["Row"];');
  out.push('export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];');
  out.push('');
  process.stdout.write(out.join('\n'));
});
