import {env} from 'cloudflare:workers';
import {getSession,resolveFactory} from '../auth/access';
import {ensureApsMetrics} from '../../aps-metrics';

export async function GET(req:Request){
 const session=getSession(req);
 if(!session)return Response.json({message:'请先登录。'},{status:401});
 try{
  const db=env.DB,factory=resolveFactory(req,session);
  await ensureApsMetrics(db);
  const since=new Date(Date.now()-30*86400000).toISOString();
  const tableRows=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('dispatch_exception_events','scenario_drafts')").all<{name:string}>();
  const tables=new Set(tableRows.results.map(row=>row.name));
  const counts:Record<string,number>={'异常发现':0,'首次查看':0,'方案生成':0,'方案确认':0,'方案采纳':0,'恢复':0,'风险解除':0};
  const metrics=await db.prepare('SELECT kind,COUNT(*) AS count FROM aps_metric_events WHERE factory=? AND recorded_at>=? GROUP BY kind')
   .bind(factory,since).all<{kind:string;count:number}>();
  for(const row of metrics.results)if(Object.hasOwn(counts,row.kind))counts[row.kind]=row.count;
  if(tables.has('dispatch_exception_events')){
   const issues=await db.prepare(`SELECT
    SUM(CASE WHEN sequence=0 THEN 1 ELSE 0 END) AS found,
    SUM(CASE WHEN stage='已解决' THEN 1 ELSE 0 END) AS resolved
    FROM dispatch_exception_events WHERE factory=? AND recorded_at>=?`).bind(factory,since).first<{found:number|null;resolved:number|null}>();
   counts.异常发现=issues?.found||0;counts.风险解除=issues?.resolved||0;
  }
  if(tables.has('scenario_drafts')){
   const plans=await db.prepare(`SELECT
    SUM(CASE WHEN json_extract(event.value,'$.kind')='确认' THEN 1 ELSE 0 END) AS confirmed,
    SUM(CASE WHEN json_extract(event.value,'$.kind')='发布' THEN 1 ELSE 0 END) AS adopted,
    SUM(CASE WHEN json_extract(event.value,'$.kind')='恢复' THEN 1 ELSE 0 END) AS restored
    FROM scenario_drafts, json_each(data,'$.events') AS event
    WHERE factory=? AND json_extract(event.value,'$.at')>=?`).bind(factory,since).first<{confirmed:number|null;adopted:number|null;restored:number|null}>();
   counts.方案确认=plans?.confirmed||0;counts.方案采纳=plans?.adopted||0;counts.恢复=plans?.restored||0;
  }
  return Response.json({counts},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return Response.json({message:'统计暂时无法读取。'},{status:500});}
}
