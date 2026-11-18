import {DatabaseSync} from 'node:sqlite';

export const catalogFactories=['xian','xingping'];
export const turning=/^(车工|粗车|精车|数控车|车削)$/;

export function catalogStatus(row){
 if(!row.workOrder||row.workOrder==='NULL'||row.pendingReports>0||row.requiresReview||!Number.isFinite(row.planned)||row.planned<=0||!Number.isFinite(row.completed)||row.completed<0||row.completed>row.planned)return 'review';
 if(row.completed===row.planned)return 'complete';
 if(row.jobStatus==='3'||row.operationStatus==='2')return 'review';
 return row.partCode?'pending':'review';
}

export function openCatalog(path){
 const db=new DatabaseSync(path,{timeout:10000});
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
  CREATE TABLE IF NOT EXISTS orders(factory TEXT,job_id TEXT,id TEXT,code TEXT,part TEXT,status TEXT,turning INTEGER,due TEXT,payload TEXT,PRIMARY KEY(factory,id));
  CREATE INDEX IF NOT EXISTS orders_job ON orders(factory,job_id);
  CREATE INDEX IF NOT EXISTS orders_code ON orders(factory,code COLLATE NOCASE,id);
  CREATE INDEX IF NOT EXISTS orders_part ON orders(factory,part COLLATE NOCASE,id);
  CREATE INDEX IF NOT EXISTS orders_status ON orders(factory,status,id);
  CREATE INDEX IF NOT EXISTS orders_draft ON orders(factory,status,turning,part,due);
  CREATE TABLE IF NOT EXISTS checkpoints(factory TEXT PRIMARY KEY,cursor TEXT NOT NULL,cutoff TEXT,seen_at TEXT,complete INTEGER NOT NULL,jobs INTEGER NOT NULL,version INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS status_reviewed(factory TEXT PRIMARY KEY);`);
 const getCheckpoint=db.prepare('SELECT * FROM checkpoints WHERE factory=?');
 const getJobs=db.prepare('SELECT id,payload FROM orders WHERE factory=? AND job_id=?');
 const getOperation=db.prepare('SELECT payload FROM orders WHERE factory=? AND id=?');
 const insert=db.prepare(`INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(factory,id) DO UPDATE SET
 job_id=excluded.job_id,code=excluded.code,part=excluded.part,status=excluded.status,turning=excluded.turning,due=excluded.due,payload=excluded.payload`);
 const remove=db.prepare('DELETE FROM orders WHERE factory=? AND id=?');
 const save=db.prepare('INSERT OR REPLACE INTO checkpoints VALUES (?,?,?,?,?,?,?)');
 const start={cursor:'',cutoff:null,seen_at:null,complete:0,jobs:0,version:0};
 return {
  close:()=>db.close(),
  progress:factory=>getCheckpoint.get(factory)||start,
  statusesChecked:factory=>Boolean(db.prepare('SELECT 1 FROM status_reviewed WHERE factory=?').get(factory)),
  markStatusesChecked:factory=>db.prepare('INSERT OR IGNORE INTO status_reviewed VALUES (?)').run(factory),
  jobsWithoutStatuses(factory,after,size){
   return db.prepare("SELECT DISTINCT job_id FROM orders WHERE factory=? AND job_id>? AND status='pending' AND json_type(payload,'$.jobStatus') IS NULL ORDER BY job_id LIMIT ?").all(factory,after,size).map(row=>row.job_id);
  },
  async holdVersion(action){
   db.exec('BEGIN IMMEDIATE');
   try{return await action();}finally{db.exec('ROLLBACK');}
  },
  commit(factory,check,jobIds,rows){
   const grouped=new Map(jobIds.map(id=>[id,[]]));
   for(const row of rows){
    if(!grouped.has(row.jobId))throw Error('MES 工单分页返回意外工序');
    grouped.get(row.jobId).push(row);
   }
   let changed=0;
   db.exec('BEGIN IMMEDIATE');
   try{
    const version=Math.max(check.version,getCheckpoint.get(factory)?.version||0);
    for(const [jobId,items] of grouped){
     const old=new Map(getJobs.all(factory,jobId).map(row=>[row.id,row.payload]));
     for(const row of items){
      const data=JSON.stringify(row),prior=old.get(row.operationId);
      old.delete(row.operationId);
      if(prior===data)continue;
      insert.run(factory,jobId,row.operationId,row.workOrder,row.partCode||'',catalogStatus(row),Number(turning.test(row.operationName)),row.due||'',data);
      changed++;
     }
     for(const id of old.keys()){remove.run(factory,id);changed++;}
    }
    save.run(factory,check.cursor,check.cutoff,check.seen_at,Number(check.complete),check.jobs,version+Number(changed>0));
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
   return changed;
  },
  list(factory,status,search,after){
   const args=[], filters=[];
   if(status){filters.push('status=?');args.push(status);}
   if(after){filters.push('id>?');args.push(after);}
   const suffix=filters.length?' AND '+filters.join(' AND '):'';
   let rows;
   if(search){
    const prefix=search.replace(/[\\%_]/g,'\\$&')+'%';
    const searchField=field=>`SELECT id,status,payload FROM orders INDEXED BY orders_${field} WHERE factory=? AND ${field} COLLATE NOCASE LIKE ? ESCAPE '\\'${suffix}`;
    rows=db.prepare(searchField('code')+' UNION '+searchField('part')+' ORDER BY id LIMIT 51').all(factory,prefix,...args,factory,prefix,...args);
   }else rows=db.prepare('SELECT id,status,payload FROM orders WHERE factory=?'+suffix+' ORDER BY id LIMIT 51').all(factory,...args);
   return {next:rows.length>50?rows[49].id:null,rows:rows.slice(0,50).map(row=>({...JSON.parse(row.payload),status:row.status}))};
  },
  planningRows(factory,parts){
   const byPart=db.prepare("SELECT payload FROM orders WHERE factory=? AND status='pending' AND turning=1 AND part=? ORDER BY due,id");
   return parts.flatMap(code=>byPart.all(factory,code).map(row=>JSON.parse(row.payload)));
  },
  linkedRows(factory,operations){
   return operations.flatMap(id=>{
    const found=getOperation.get(factory,id);
    if(!found)return [];
    const row=JSON.parse(found.payload);
    return [catalogStatus(row)==='review'?{...row,requiresReview:true}:row];
   });
  },
  totals(factory){return Object.fromEntries(db.prepare('SELECT status,count(*) n FROM orders WHERE factory=? GROUP BY status').all(factory).map(row=>[row.status,row.n]));},
 };
}
