#!/usr/bin/env python3
"""Deterministic, read-only intake. Only --send delivers private proposals.
Never creates/updates tasks or Drive files. Durable uncertain-send protection.
"""
import argparse, collections, datetime as dt, fcntl, hashlib, json, os, pathlib, re, signal, sqlite3, subprocess, sys, time
from types import SimpleNamespace
TOOLS=pathlib.Path(os.environ.get('RENDER_MONITOR_TOOLS','/root/.openclaw/workspace/tools'))
sys.path.insert(0,str(TOOLS))
STATE=TOOLS/'state/render-visit-material'
FOLDER='application/vnd.google-apps.folder'
FRANCO='+5493794693647'

def folder_ids(task):
    text=json.dumps({k:task.get(k) for k in ('aclaraciones','material_referencia','propiedades_extra','comentarios')},ensure_ascii=False)
    return sorted(set(re.findall(r'https?://drive\.google\.com/(?:drive/(?:u/\d+/)?folders/|folderview\?id=)([\w-]{10,})',text)))

def fingerprint(task,files):
    value={'folders':folder_ids(task),'files':sorted((f['id'],f.get('modifiedTime'),f.get('size'),f.get('name')) for f in files),
           'estado':task.get('estado'),'registros':task.get('propiedades_extra',{}).get('produccion_registros',[])}
    return hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()

def recent(task,now):
    values=[task.get('fecha_vencimiento'),task.get('updated_at'),task.get('created_at')]
    values += [c.get('created_at') for c in task.get('comentarios',[])]
    for value in values:
        if value:
            try:
                date=dt.datetime.fromisoformat(str(value).replace('Z','+00:00')).date()
                if now.date()-dt.timedelta(days=7)<=date<=now.date():return True
            except ValueError:pass
    return False

def all_visits(client):
    out=[];cursor=0
    for _ in range(1000):
        page=client(cursor);out.extend(page['tasks']);nxt=page.get('next_after')
        if nxt is None:return out
        if not isinstance(nxt,int) or nxt<=cursor:raise RuntimeError('Invalid/nonadvancing task cursor')
        cursor=nxt
    raise RuntimeError('Task pagination exceeded safety bound; scan incomplete')

def inventory(roots,drive):
    files={};seen=set();queue=collections.deque((r,0,r) for r in roots)
    while queue:
        folder,depth,path=queue.popleft()
        if folder in seen:continue
        if depth>12 or len(seen)>=300:raise RuntimeError('Folder scan incomplete: safety bound')
        seen.add(folder);token=None
        while True:
            params={'q':f"'{folder}' in parents and trashed=false",'pageSize':1000,'fields':'nextPageToken,files(id,name,mimeType,modifiedTime,size,webViewLink,shortcutDetails)', 'supportsAllDrives':'true','includeItemsFromAllDrives':'true'}
            if token:params['pageToken']=token
            data=drive('GET','files',params=params)
            for f in data.get('files',[]):
                if f.get('mimeType')==FOLDER:queue.append((f['id'],depth+1,path+'/'+f['name']))
                elif f.get('mimeType')=='application/vnd.google-apps.shortcut':
                    target=f.get('shortcutDetails',{})
                    if target.get('targetMimeType')==FOLDER:queue.append((target['targetId'],depth+1,path+'/'+f['name']))
                    else:raise RuntimeError('File shortcut needs manual review; scan incomplete')
                else:
                    files[f['id']]={**f,'folderId':folder,'folderPath':path}
                    if len(files)>10000:raise RuntimeError('File scan incomplete: safety bound')
            token=data.get('nextPageToken')
            if not token:break
    return list(files.values())

def proposal(task,files):
    videos=[f for f in files if f.get('mimeType','').startswith('video/')]
    photos=[f for f in files if f.get('mimeType','').startswith('image/')]
    groups=collections.Counter(f['folderId'] for f in videos)
    lines=[f"📁 Material para revisar — {task.get('cliente_nombre') or task['titulo']}",f"Visita #{task['id']}: {task['titulo']}",f"Encontré {len(videos)} clips de video y {len(photos)} fotos. Los clips no equivalen necesariamente a videos finales."]
    for folder,count in list(groups.items())[:8]:
        label=next(f['folderPath'].split('/')[-1] for f in videos if f['folderId']==folder)
        lines.append(f"• {label}: {count} clips — https://drive.google.com/drive/folders/{folder}")
    if len(groups)>8:lines.append(f"Hay {len(groups)-8} carpetas adicionales en el detalle de la propuesta.")
    if not videos:
        for folder in folder_ids(task)[:3]:lines.append('https://drive.google.com/drive/folders/'+folder)
        lines.append('Falta identificar material de video para proponer edición.')
    elif task.get('ediciones_vinculadas'):
        lines.append('Ya hay edición vinculada: '+', '.join('#'+str(t['id']) for t in task['ediciones_vinculadas'])+'. Revisar si corresponde sumar este material; no duplicar la tarea.')
    else:lines.append('Propuesta: asignar a Luciano los videos que apruebes de estas carpetas. Falta confirmar cuáles y la fecha de entrega.')
    lines += ['No evalué la calidad de las tomas. Revisá el material primero; no creé ninguna tarea.',f"Respondé «revisemos visita {task['id']}» para preparar la confirmación.",task.get('url',f"https://sistema.rendercorrientes.com/workspace/tareas?task={task['id']}")]
    return '\n'.join(lines)

def receipt(value):
    if isinstance(value,dict):
        if value.get('messageId'):return True
        return any(receipt(v) for v in value.values())
    if isinstance(value,list):return any(receipt(v) for v in value)
    return False

def deliver(db,key,text,sender):
    row=db.execute('SELECT status FROM deliveries WHERE id=?',(key,)).fetchone()
    if row:return row[0]
    db.execute("INSERT INTO deliveries VALUES (?, 'uncertain')",(key,));db.commit()
    result=sender(text)
    if not receipt(result):raise RuntimeError('Delivery receipt missing; retained as uncertain, no blind retry')
    db.execute("UPDATE deliveries SET status='sent' WHERE id=?",(key,));db.commit();return 'sent'

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--send',action='store_true');ap.add_argument('--state-dir',type=pathlib.Path,default=STATE);args=ap.parse_args()
    args.state_dir.mkdir(parents=True,exist_ok=True,mode=0o700)
    lock=(args.state_dir/'monitor.lock').open('w')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:print('{"status":"busy"}');return
    import mia_render_os_task as api, drive_fast as drive
    actor=SimpleNamespace(actor_id=FRANCO,actor_name='Franco Altamirano',group_id='')
    tasks=all_visits(lambda after:api.request('GET',f'/visitas-material?after={after}',actor))
    db=sqlite3.connect(args.state_dir/'state.sqlite');os.chmod(args.state_dir/'state.sqlite',0o600)
    db.execute('PRAGMA synchronous=FULL');db.execute('CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, fingerprint TEXT)');db.execute('CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY,status TEXT)');db.commit()
    db.execute('CREATE TABLE IF NOT EXISTS progress (id INTEGER PRIMARY KEY, task_id TEXT)');db.commit()
    tasks=sorted(tasks,key=lambda t:str(t.get('fecha_vencimiento') or ''),reverse=True)
    cursor=db.execute('SELECT task_id FROM progress WHERE id=1').fetchone()
    if cursor:
        indexes=[i for i,t in enumerate(tasks) if str(t['id'])==cursor[0]]
        if indexes:
            cut=indexes[0]+1;tasks=tasks[cut:]+tasks[:cut]
    now=dt.datetime.now(dt.timezone.utc);stats={'tasks':len(tasks),'proposals':0,'sent':0,'errors':[]};deadline=time.monotonic()+140
    for task in tasks:
        if time.monotonic()>deadline:stats['errors'].append('Scan time budget reached; remaining visits deferred');break
        tid=str(task['id']);roots=folder_ids(task)
        if args.send:
            db.execute('INSERT OR REPLACE INTO progress VALUES (1,?)',(tid,));db.commit()
        complete=bool(task.get('propiedades_extra',{}).get('produccion_finalizada_at')) or task.get('estado') in ('en_revision','publicada','completada')
        if not roots and not complete:continue
        try:
            files=inventory(roots,drive.request);fp=fingerprint(task,files)
            prev=db.execute('SELECT fingerprint FROM snapshots WHERE id=?',(tid,)).fetchone()
            changed=(bool(files) or complete) and (prev[0]!=fp if prev else recent(task,now))
            if changed:
                stats['proposals']+=1;key=tid+'-'+fp
                text=proposal(task,files)
                packet={'task':task,'files':files,'fingerprint':fp,'text':text,'prepared_at':now.isoformat()}
                if args.send:
                    (args.state_dir/(key+'.json')).write_text(json.dumps(packet,ensure_ascii=False,indent=2))
                    if stats['sent']>=3:continue
                    def sender(message):
                        r=subprocess.run(['openclaw','message','send','--channel','whatsapp','--account','render-3794145157','--target',FRANCO,'--message',message,'--json'],capture_output=True,text=True,check=True,timeout=45)
                        return json.loads(r.stdout)
                    status=deliver(db,key,text,sender)
                    if status!='sent':stats['errors'].append(f'Visit {tid}: uncertain delivery; manual review required');continue
                    stats['sent']+=1
                else:print(json.dumps({'preview':text},ensure_ascii=False))
            if args.send:
                db.execute('INSERT OR REPLACE INTO snapshots VALUES (?,?)',(tid,fp));db.commit()
        except Exception as e:stats['errors'].append(f'Visit {tid}: {type(e).__name__}: {str(e)[:160]}')
    print(json.dumps(stats,ensure_ascii=False))
    if stats['errors']:raise SystemExit(1)
if __name__=='__main__':main()
