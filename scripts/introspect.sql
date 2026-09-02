-- מוציא את מבנה הסכמה כ-JSON יחיד עבור scripts/gen-types.mjs
select json_build_object(
  'enums', (
    select coalesce(json_agg(json_build_object('name', t.typname, 'values', v.vals) order by t.typname), '[]'::json)
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace and n.nspname = 'public'
    join lateral (select json_agg(e.enumlabel order by e.enumsortorder) vals
                  from pg_enum e where e.enumtypid = t.oid) v on true
    where t.typtype = 'e'
  ),
  'functions', (
    select coalesce(json_agg(json_build_object(
      'name', p.proname,
      'args', (select coalesce(json_agg(json_build_object(
                 'name', coalesce(p.proargnames[i], 'arg' || i),
                 'type', format_type(p.proargtypes[i-1], null)) order by i), '[]'::json)
               from generate_series(1, p.pronargs) i),
      'returns', format_type(p.prorettype, null),
      'returns_set', p.proretset
    ) order by p.proname), '[]'::json)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.prokind = 'f' and p.proname like 'rpc\_%'
  ),
  'relations', (
    select coalesce(json_agg(r order by r->>'name'), '[]'::json) from (
      select json_build_object(
        'name', c.relname,
        'kind', case c.relkind when 'r' then 'table' else 'view' end,
        'relationships', (
          select coalesce(json_agg(json_build_object(
            'foreignKeyName', con.conname,
            'columns', (select json_agg(att.attname order by u.ord)
                        from unnest(con.conkey) with ordinality u(attnum, ord)
                        join pg_attribute att on att.attrelid = con.conrelid and att.attnum = u.attnum),
            'isOneToOne', exists (
              select 1 from pg_index i
              where i.indrelid = con.conrelid and i.indisunique
                and i.indnatts = array_length(con.conkey,1)
                and i.indkey::int2[] @> con.conkey and con.conkey @> i.indkey::int2[]
            ),
            'referencedRelation', rel.relname,
            'referencedColumns', (select json_agg(att.attname order by u.ord)
                        from unnest(con.confkey) with ordinality u(attnum, ord)
                        join pg_attribute att on att.attrelid = con.confrelid and att.attnum = u.attnum)
          ) order by con.conname), '[]'::json)
          from pg_constraint con
          join pg_class rel on rel.oid = con.confrelid
          where con.conrelid = c.oid and con.contype = 'f'
        ),
        'columns', (
          select json_agg(json_build_object(
            'name', a.attname,
            'type', format_type(a.atttypid, null),
            'nullable', not a.attnotnull,
            'hasDefault', a.atthasdef or c.relkind = 'v'
          ) order by a.attnum)
          from pg_attribute a
          where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        )
      ) as r
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relkind in ('r','v')
    ) s
  )
);
