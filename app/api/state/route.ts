import {env} from 'cloudflare:workers';
import {getSession,resolveFactory} from '../auth/access';
const seed='{}';
async function ensure(){
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS factory_state (factory TEXT PRIMARY KEY CHECK(factory IN ('xian','xingping')), data TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
 const old=await env.DB.prepare(`SELECT data FROM app_state WHERE id=1`).first<{data:string}>().catch(()=>null);
 if(old)await env.DB.prepare(`INSERT OR IGNORE INTO factory_state(factory,data,updated_at) VALUES('xian',?,CURRENT_TIMESTAMP)`).bind(old.data).run();
}
export async function GET(req:Request){const session=getSession(req);if(!session)return Response.json({error:'unauthorized'},{status:401});try{await ensure();const factory=resolveFactory(req,session),row=await env.DB.prepare('SELECT data FROM factory_state WHERE factory=?').bind(factory).first<{data:string}>();return Response.json({state:row?JSON.parse(row.data):null,factory})}catch(e){return Response.json({error:String(e),state:null},{status:500})}}
export async function PUT(req:Request){const session=getSession(req);if(!session)return Response.json({error:'unauthorized'},{status:401});try{await ensure();const factory=resolveFactory(req,session),state=await req.json();await env.DB.prepare(`INSERT INTO factory_state(factory,data,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(factory) DO UPDATE SET data=excluded.data,updated_at=CURRENT_TIMESTAMP`).bind(factory,JSON.stringify(state||seed)).run();return Response.json({ok:true,factory})}catch(e){return Response.json({error:String(e)},{status:500})}}
