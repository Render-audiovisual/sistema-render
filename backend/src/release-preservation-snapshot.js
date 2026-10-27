import {createHash} from 'node:crypto';

// No pool, environment, filesystem, DDL or transaction ownership. Caller must
// retain one client inside REPEATABLE READ READ ONLY and close it promptly.
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const qi=value=>'"'+value.replaceAll('"','""')+'"';
const fail=()=>new Error('No se pudo verificar el estado de preparación; no se autoriza publicar.');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const name=value=>typeof value==='string'&&value.length>0&&value.length<=63&&!/[\u0000-\u001f\u007f]/.test(value);

export function validateReleaseSnapshot(value){
  if(!exact(value,['version','identity','tables','sha256'])||value.version!==1||!hex(value.sha256)
    ||!exact(value.identity,['database','username','address','port'])
    ||!['database','username','address'].every(key=>typeof value.identity[key]==='string'&&value.identity[key].length>0&&value.identity[key].length<=256)
    ||!Number.isInteger(value.identity.port)||value.identity.port<1||value.identity.port>65535
    ||!Array.isArray(value.tables)||!value.tables.length||value.tables.length>1000)throw fail();
  let previous='';
  for(const t of value.tables){
    if(!exact(t,['name','columns','rows','dataSha256','securitySha256'])||!name(t.name)||t.name<=previous
      ||!Array.isArray(t.columns)||t.columns.length>5000||!t.columns.length
      ||typeof t.rows!=='string'||!/^(0|[1-9]\d*)$/.test(t.rows)||t.rows.length>30
      ||!hex(t.dataSha256)||!hex(t.securitySha256))throw fail();
    previous=t.name;const seen=new Set();
    for(const c of t.columns){
      if(!exact(c,['name','type','notNull'])||!name(c.name)||seen.has(c.name)
        ||typeof c.type!=='string'||!c.type||c.type.length>2000||typeof c.notNull!=='boolean')throw fail();
      seen.add(c.name);
    }
  }
  const body={version:1,identity:value.identity,tables:value.tables};
  if(sha(body)!==value.sha256)throw fail();
  return structuredClone(value);
}

async function context(db){
  const row=(await db.query(`SELECT current_setting('transaction_read_only') AS read_only,
    current_setting('transaction_isolation') AS isolation,pg_current_snapshot()::text AS snapshot,
    current_database() AS database,current_user AS username,host(inet_server_addr()) AS address,
    inet_server_port() AS port`)).rows[0];
  if(row?.read_only!=='on'||row.isolation!=='repeatable read'||!row.snapshot
    ||!['database','username','address'].every(key=>typeof row[key]==='string'&&row[key])
    ||!Number.isInteger(row.port))throw fail();
  return row;
}

export async function captureReleaseSnapshot(db){
  try{
    const before=await context(db);
    // Session-local formatting only; no persistent settings or table writes.
    await db.query(`SELECT set_config('TimeZone','UTC',true),set_config('DateStyle','ISO, MDY',true),
      set_config('IntervalStyle','postgres',true),set_config('extra_float_digits','3',true),
      set_config('search_path','pg_catalog',true),set_config('statement_timeout','15000ms',true),
      set_config('lock_timeout','3000ms',true)`);
    const tables=(await db.query(`SELECT c.relname AS name,c.oid::text AS oid,
      row_security_active(c.oid) AS filtered FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname COLLATE "C"`)).rows;
    if(tables.length>1000||tables.some(t=>!name(t.name)||!/^[1-9]\d*$/.test(t.oid)||t.filtered!==false))throw fail();
    const observations=[];
    for(const t of tables){
      const columns=(await db.query(`SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,
        a.attnotnull AS "notNull" FROM pg_attribute a WHERE a.attrelid=$1::oid
        AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,[t.oid])).rows;
      const data=(await db.query(`SELECT count(*)::text AS rows,
        encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h COLLATE "C"),''),'UTF8')),'hex') AS hash
        FROM (SELECT encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS h
          FROM ONLY public.${qi(t.name)} r) hashed`)).rows[0];
      const security=(await db.query(`SELECT encode(sha256(convert_to(jsonb_build_object(
        'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,
        'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,a.attacl::text,a.attcollation::text,
          pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a
          LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
          WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
        'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid),
        'constraints',(SELECT jsonb_agg(jsonb_build_array(k.conname,k.convalidated,k.condeferrable,
          pg_get_constraintdef(k.oid)) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid),
        'indexes',(SELECT jsonb_agg(jsonb_build_array(ic.relname,i.indisvalid,i.indisready,
          pg_get_indexdef(i.indexrelid)) ORDER BY ic.relname) FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid
          WHERE i.indrelid=c.oid),
        'triggers',(SELECT jsonb_agg(jsonb_build_array(g.tgname,g.tgenabled,pg_get_triggerdef(g.oid),
          md5(p.prosrc),p.prosecdef,p.proconfig) ORDER BY g.tgname)
          FROM pg_trigger g JOIN pg_proc p ON p.oid=g.tgfoid WHERE g.tgrelid=c.oid AND NOT g.tgisinternal)
        )::text,'UTF8')),'hex') AS hash FROM pg_class c WHERE c.oid=$1::oid`,[t.oid])).rows[0];
      observations.push({name:t.name,columns,rows:data?.rows,dataSha256:data?.hash,securitySha256:security?.hash});
    }
    const after=await context(db);
    if(JSON.stringify(before)!==JSON.stringify(after))throw fail();
    const body={version:1,identity:{database:before.database,username:before.username,address:before.address,port:before.port},tables:observations};
    return validateReleaseSnapshot({...body,sha256:sha(body)});
  }catch{throw fail();} // Never echo query, credentials, row data or raw SQL errors.
}

export async function compareReleaseSnapshot(db,reference){
  const expected=validateReleaseSnapshot(reference); // Copy before any await.
  const current=await captureReleaseSnapshot(db);
  const old=new Map(expected.tables.map(t=>[t.name,t])),now=new Map(current.tables.map(t=>[t.name,t]));
  const names=[...new Set([...old.keys(),...now.keys()])].sort();
  const changedTables=names.filter(n=>JSON.stringify(old.get(n))!==JSON.stringify(now.get(n)));
  return {matches:expected.sha256===current.sha256,currentSha256:current.sha256,changedTables,
    schemaChanged:names.some(n=>JSON.stringify(old.get(n)?.columns)!==JSON.stringify(now.get(n)?.columns)
      ||old.get(n)?.securitySha256!==now.get(n)?.securitySha256)
      ||JSON.stringify(expected.identity)!==JSON.stringify(current.identity)};
}
