import {env} from 'cloudflare:workers';
import {getSession,resolveFactory} from '../auth/access';

type StateRow={data:string;revision:number};
type SaveBody={state?:unknown;expectedRevision?:number;action?:string;summary?:string;restoreBackupId?:string};

async function ensure(){
 const db=env.DB;
 await db.batch([
  db.prepare(`CREATE TABLE IF NOT EXISTS factory_state (factory TEXT PRIMARY KEY CHECK(factory IN ('xian','xingping')), data TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, revision INTEGER NOT NULL DEFAULT 1)`),
  db.prepare(`CREATE TABLE IF NOT EXISTS factory_state_backup (id TEXT PRIMARY KEY, factory TEXT NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
  db.prepare(`CREATE TABLE IF NOT EXISTS factory_audit (id TEXT PRIMARY KEY, factory TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, summary TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_factory_backup_factory_created ON factory_state_backup(factory,created_at DESC)`),
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_factory_audit_factory_created ON factory_audit(factory,created_at DESC)`),
 ]);
 await db.prepare(`ALTER TABLE factory_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 1`).run().catch(()=>null);
 const old=await db.prepare(`SELECT data FROM app_state WHERE id=1`).first<{data:string}>().catch(()=>null);
 if(old)await db.prepare(`INSERT OR IGNORE INTO factory_state(factory,data,updated_at,revision) VALUES('xingping',?,CURRENT_TIMESTAMP,1)`).bind(old.data).run();
}

async function extras(factory:string){
 const [audit,backups]=await Promise.all([
  env.DB.prepare(`SELECT id,actor,action,summary,revision,created_at AS createdAt FROM factory_audit WHERE factory=? ORDER BY created_at DESC LIMIT 30`).bind(factory).all(),
  env.DB.prepare(`SELECT id,actor,action,revision,created_at AS createdAt FROM factory_state_backup WHERE factory=? ORDER BY created_at DESC LIMIT 12`).bind(factory).all(),
 ]);
 return {audit:audit.results,backups:backups.results};
}

export async function GET(req:Request){
 const session=getSession(req);if(!session)return Response.json({error:'unauthorized'},{status:401});
 try{await ensure();const factory=resolveFactory(req,session),row=await env.DB.prepare(`SELECT data,revision FROM factory_state WHERE factory=?`).bind(factory).first<StateRow>();return Response.json({state:row?JSON.parse(row.data):null,factory,revision:row?.revision||0,...await extras(factory)})}catch(e){return Response.json({error:String(e),state:null},{status:500})}
}

export async function PUT(req:Request){
 const session=getSession(req);if(!session)return Response.json({error:'unauthorized'},{status:401});
 try{
  await ensure();const factory=resolveFactory(req,session),body=await req.json() as SaveBody,actor=session.displayName||'未知用户';
  const current=await env.DB.prepare(`SELECT data,revision FROM factory_state WHERE factory=?`).bind(factory).first<StateRow>();
  const expected=Number(body.expectedRevision||0);
  if(current&&expected!==current.revision)return Response.json({error:'conflict',message:'数据已被其他用户更新',currentRevision:current.revision},{status:409});
  let nextState=body.state;
  if(body.restoreBackupId){const backup=await env.DB.prepare(`SELECT data FROM factory_state_backup WHERE id=? AND factory=?`).bind(body.restoreBackupId,factory).first<{data:string}>();if(!backup)return Response.json({error:'backup_not_found'},{status:404});nextState=JSON.parse(backup.data)}
  if(!nextState)return Response.json({error:'missing_state'},{status:400});
  const action=body.action||'更新数据',summary=body.summary||action,nextRevision=(current?.revision||0)+1,now=new Date().toISOString();
  if(current){
   await env.DB.prepare(`INSERT INTO factory_state_backup(id,factory,data,revision,actor,action,created_at) VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),factory,current.data,current.revision,actor,action,now).run();
   const updated=await env.DB.prepare(`UPDATE factory_state SET data=?,updated_at=CURRENT_TIMESTAMP,revision=? WHERE factory=? AND revision=?`).bind(JSON.stringify(nextState),nextRevision,factory,current.revision).run();
   if(!updated.meta.changes)return Response.json({error:'conflict',message:'数据已被其他用户更新'},{status:409});
  }else await env.DB.prepare(`INSERT INTO factory_state(factory,data,updated_at,revision) VALUES(?,?,CURRENT_TIMESTAMP,?)`).bind(factory,JSON.stringify(nextState),nextRevision).run();
  await env.DB.prepare(`INSERT INTO factory_audit(id,factory,actor,action,summary,revision,created_at) VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),factory,actor,action,summary,nextRevision,now).run();
  await env.DB.prepare(`DELETE FROM factory_state_backup WHERE factory=? AND id NOT IN (SELECT id FROM factory_state_backup WHERE factory=? ORDER BY created_at DESC LIMIT 20)`).bind(factory,factory).run();
  return Response.json({ok:true,factory,state:nextState,revision:nextRevision,...await extras(factory)});
 }catch(e){return Response.json({error:String(e)},{status:500})}
}
