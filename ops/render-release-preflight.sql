-- INSPECTION ONLY. Run against the explicitly verified Render project.
-- This is not a migration, backup, publication or authorization to write.
-- Keep results in the dashboard unless local retention is explicitly approved.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='15000ms';
SET LOCAL lock_timeout='3000ms';
SET LOCAL timezone='UTC';
SELECT jsonb_build_object(
  'version',1,
  'observed_at',statement_timestamp(),
  'database',current_database(),
  'server_version',current_setting('server_version_num'),
  'read_only',current_setting('transaction_read_only'),
  'ledger',(SELECT jsonb_agg(nombre ORDER BY nombre) FROM public._migrations),
  'task_count',(SELECT count(*) FROM public.tareas),
  'task_content_hash',(SELECT md5(coalesce(string_agg(h,'' ORDER BY h),''))
    FROM (SELECT md5(to_jsonb(t)::text) h FROM public.tareas t) rows),
  'tables',(SELECT jsonb_agg(jsonb_build_object(
    'name',c.relname,'rls',c.relrowsecurity,
    'anonymous_read',has_table_privilege('anon',c.oid,'SELECT'),
    'member_read',has_table_privilege('authenticated',c.oid,'SELECT'),
    'anonymous_write',has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE'),
    'member_write',has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE'),
    'column_shape_hash',(SELECT md5(coalesce(string_agg(
      jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
        pg_get_expr(d.adbin,d.adrelid))::text,'' ORDER BY a.attnum),''))
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
    'policy_count',(SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)) ORDER BY c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN('r','p')),
  'unsafe_definer_count',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
      AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))),
  'default_public_grant_count',(SELECT count(*) FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid=d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
    LEFT JOIN pg_roles r ON r.oid=acl.grantee
    WHERE n.nspname='public' AND (acl.grantee=0 OR r.rolname IN('anon','authenticated')))
) AS render_release_preflight;
COMMIT;
