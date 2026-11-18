import {readFile,rename,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createConnection} from 'mysql2/promise';
import {buildMesOperationPreviewQuery,readMesOperationPreview} from '../app/server/mes-operation-preview.ts';
import {mergeMesLocalOrders} from '../app/server/mes-local-orders.ts';

const factories=['xian','xingping'];
const initial={orders:[],parts:[],workers:[],allocations:[],history:[],lastRun:''};

export function apsOrders(origin,token){
 const url=new URL(origin);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||!token)throw Error('序衡服务必须使用本机地址和明确的账号配置');
 const headers={cookie:'xuheng_session='+encodeURIComponent(token)};
 const endpoint=factory=>new URL('/api/state?factory='+factory,url);
 return {
  async read(factory){
   const response=await fetch(endpoint(factory),{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error('序衡状态读取失败 '+response.status);
   const payload=await response.json();
   if(payload.factory!==factory||!Number.isSafeInteger(payload.revision))throw Error('序衡工厂或版本不匹配');
   return {...payload,state:payload.state||initial};
  },
  async write(factory,revision,state,summary,action='同步 MES 工单'){
   const response=await fetch(endpoint(factory),{method:'PUT',headers:{...headers,'content-type':'application/json',prefer:'return=minimal'},redirect:'error',signal:AbortSignal.timeout(10000),
    body:JSON.stringify({state,expectedRevision:revision,action,summary})});
   if(response.status===409)return false;
   if(!response.ok)throw Error('序衡订单保存失败 '+response.status);
   const payload=await response.json();
   if(!payload.ok||payload.factory!==factory||payload.revision!==revision+1)throw Error('序衡保存确认无效');
   return true;
  },
 };
}

export async function saveMesOrders(aps,factory,rows){
 for(let attempt=0;attempt<4;attempt++){
  const {state,revision}=await aps.read(factory);
  const result=mergeMesLocalOrders(factory,state,rows);
  const {added,updated,held}=result;
  if(result.state===state&&state.mesOrderSync)return {added,updated,held,changed:false};
  const next={...result.state,mesOrderSync:{lastChangedAt:new Date().toISOString()}};
  if(await aps.write(factory,revision,next,`MES 新增 ${added} 道工序，更新 ${updated} 道，待核对 ${held} 道`))return {added,updated,held,changed:true};
 }
 throw Error('序衡订单保存版本冲突');
}

async function readReplica(connection,factory,orders,since){
 const linked=[...new Set(orders.map(order=>order.orderNo).filter(code=>/^[A-Z0-9-]{1,60}$/.test(code)))];
 const sql=buildMesOperationPreviewQuery(factory,[],true,{cursor:'',since,scanOlder:false},linked);
 await connection.query('START TRANSACTION READ ONLY');
 try{
  const [[settings]]=await connection.query("SELECT @@GLOBAL.read_only,DATE_FORMAT(NOW(),'%Y-%m-%d %H:%i:%s')");
  const [readOnly,at]=settings;
  if(Number(readOnly)!==1)throw Error('MES 连接目标须为只读从库');
  const [raw]=await connection.query({sql,timeout:15000});
  const parsed=readMesOperationPreview(raw.map(row=>row.map(value=>value===null?'NULL':String(value)).join('\t')).join('\n'));
  return {at,rows:parsed.map(row=>({operationId:row.operationId,workOrder:row.workOrder,operationNo:row.operationNo,operationName:row.operationName,
   ...row.orderMetadata,planned:row.planned,completed:row.reported,pendingReports:row.withheldGroups+row.unresolved,requiresReview:!row.readyForReview}))};
 }finally{await connection.query('ROLLBACK');}
}

async function main(){
 const {APP_SESSION_TOKEN,MES_REPLICA_PASSWORD,MES_APS_ORIGIN='http://127.0.0.1:3000',STATE_DIRECTORY}=process.env;
 if(!MES_REPLICA_PASSWORD||!STATE_DIRECTORY)throw Error('缺少 MES 只读连接或同步位置配置');
 const aps=apsOrders(MES_APS_ORIGIN,APP_SESSION_TOKEN);
 const checkpointFile=join(STATE_DIRECTORY,'checkpoint.json');
 const checkpoint=JSON.parse(await readFile(checkpointFile,'utf8').catch(error=>{
  if(error.code!=='ENOENT')throw error;
  return '{}';
 }));
 const connection=await createConnection({host:'127.0.0.1',port:12011,user:'repl',password:MES_REPLICA_PASSWORD,rowsAsArray:true,connectTimeout:5000,multipleStatements:false});
 try{
  for(const factory of factories){
   const {state}=await aps.read(factory);
   const snapshot=await readReplica(connection,factory,state.orders,checkpoint[factory]);
   const summary=await saveMesOrders(aps,factory,snapshot.rows);
   checkpoint[factory]=snapshot.at;
   await writeFile(checkpointFile+'.tmp',JSON.stringify(checkpoint),{mode:0o600});
   await rename(checkpointFile+'.tmp',checkpointFile);
   console.log(JSON.stringify({factory,checked:snapshot.rows.length,...summary}));
  }
 }finally{await connection.end();}
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{
 console.error('MES 同步失败',error.code||error.message);
 process.exitCode=1;
});
