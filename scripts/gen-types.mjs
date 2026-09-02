#!/usr/bin/env node
// מחולל src/lib/database.types.ts מהקטלוג של פוסטגרס.
//
// ⚠️ פתרון ביניים בלבד. `supabase gen types` דורש דוקר שאינו זמין כאן.
// ברגע שנתחבר לפרויקט Supabase אמיתי, המחולל הזה **נמחק** ו-gen:types
// יצביע על ה-CLI הרשמי. שני מקורות טיפוסים = באג שמחכה לקרות.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const FROM_LOCAL = process.argv.includes('--from-local-postgres');

function readInput() {
  if (!FROM_LOCAL) {
    return new Promise((resolve) => {
      let raw = '';
      process.stdin.on('data', (c) => (raw += c));
      process.stdin.on('end', () => resolve(raw));
    });
  }
  const sql = readFileSync(new URL('./introspect.sql', import.meta.url), 'utf8');
  return execFileSync(
    'psql',
    ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'teichtal', '-tAqc', sql],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
}

const main = async () => {
  const { enums, relations, functions = [] } = JSON.parse(await readInput());
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
  // רק פונקציות rpc_* — אלה שהפרונט קורא להן דרך supabase.rpc()
  if (functions.length === 0) {
    out.push('    Functions: { [_ in never]: never };');
  } else {
    out.push('    Functions: {');
    for (const f of functions) {
      out.push(`      ${f.name}: {`);
      if (f.args.length === 0) {
        out.push('        Args: Record<PropertyKey, never>;');
      } else {
        out.push('        Args: {');
        for (const a of f.args) out.push(`          ${a.name}: ${tsType(a.type)};`);
        out.push('        };');
      }
      const ret = f.returns === 'void' ? 'undefined' : tsType(f.returns);
      out.push(`        Returns: ${f.returns_set ? `${ret}[]` : ret};`);
      out.push('      };');
    }
    out.push('    };');
  }
  out.push('    CompositeTypes: { [_ in never]: never };');
  out.push('  };');
  out.push('};');
  out.push('');
  out.push('export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];');
  out.push('export type Views<T extends keyof Database["public"]["Views"]> = Database["public"]["Views"][T]["Row"];');
  out.push('export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];');
  out.push('');
  process.stdout.write(out.join('\n'));
};

main().catch((e) => {
  console.error(`\n✗ יצירת הטיפוסים נכשלה: ${e.message}\n`);
  process.exit(1);
});
