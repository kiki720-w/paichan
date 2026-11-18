import {createConnection} from 'mysql2/promise';
import {setTimeout as wait} from 'node:timers/promises';
import {join} from 'node:path';
import {buildMesOperationPreviewQuery,readMesOperationPreview} from '../app/server/mes-operation-preview.ts';
import {openCatalog,catalogFactories} from './mes-catalog-store.mjs';

const databases={xian:'db00xadl',xingping:'db00xpdl'};
const pageSize=Number(process.env.MES_CATALOG_PAGE_SIZE||1800);
const port=Number(process.env.MES_CATALOG_MYSQL_PORT||33121);
const path=process.env.MES_CATALOG_DB||(process.env.STATE_DIRECTORY&&join(process.env.STATE_DIRECTORY,'orders.sqlite'));
const password=process.env.MES_REPLICA_PASSWORD;
if(!path||!password||!Number.isInteger(pageSize)||pageSize<1||pageSize>6000||!Number.isInteger(port)||port<1||port>65535)throw Error('MES 目录或从库只读配置无效');
const catalog=openCatalog(path);

async function readBatch(connection,factory,jobs){
 const active=jobs.filter(row=>String(row[2])==='0');
 const activeIds=active.map(row=>row[0]);
 if(!activeIds.length)return [];
 const sql=buildMesOperationPreviewQuery(factory,[],false,undefined,[],activeIds);
 const [raw]=await connection.query({sql,timeout:25000});
 const operations=readMesOperationPreview(raw.map(columns=>columns.map(value=>value===null?'NULL':String(value))));
 const rows=operations.map(row=>{
  const {partCode,partName,drawingNo,due,customer}=row.orderMetadata||{};
  return {jobId:row.jobId,jobStatus:row.jobStatus,operationStatus:row.operationStatus,operationId:row.operationId,workOrder:row.workOrder,operationNo:row.operationNo,operationName:row.operationName,
   partCode,partName,drawingNo,due,customer,planned:row.planned,completed:row.reported,pendingReports:row.withheldGroups+row.unresolved,requiresReview:!row.readyForReview};
 });
 const referenced=new Set(rows.map(row=>row.jobId));
 for(const [jobId,workOrder] of active)if(!referenced.has(jobId))rows.push({jobId,workOrder,operationId:'job:'+jobId,operationNo:'',operationName:'',planned:null,completed:0,pendingReports:0,requiresReview:true});
 return rows;
}

async function syncFactory(factory){
 const database=databases[factory];
 const connection=await createConnection({host:'127.0.0.1',port,user:'repl',password,multipleStatements:false,rowsAsArray:true,compress:true,connectTimeout:6000});
 try{
  const [[config]]=await connection.query('SELECT @@GLOBAL.read_only');
  if(Number(config[0])!==1)throw Error('同步连接目标不是只读从库');
  let checkpoint=catalog.progress(factory),round=0;
  if(!checkpoint.complete)console.log(JSON.stringify({factory,backfill:'started',jobs:checkpoint.jobs}));
  while(!checkpoint.complete){
   await connection.query('START TRANSACTION READ ONLY');
   try{
    const [[[at]]]=await connection.query("SELECT DATE_FORMAT(NOW(),'%Y-%m-%d %H:%i:%s')");
    const [jobs]=await connection.execute(`SELECT id,job_code,status FROM ${database}.bjob WHERE id>? ORDER BY id LIMIT ${pageSize}`,[checkpoint.cursor]);
    const rows=await readBatch(connection,factory,jobs);
    const next={...checkpoint,cursor:jobs.at(-1)?.[0]||checkpoint.cursor,cutoff:checkpoint.cutoff||at,complete:jobs.length<pageSize,jobs:checkpoint.jobs+jobs.length};
    next.seen_at=next.complete?next.cutoff:null;
    catalog.commit(factory,next,jobs.map(job=>job[0]),rows);
    checkpoint=catalog.progress(factory);
    if(++round%10===0||checkpoint.complete)console.log(JSON.stringify({factory,jobs:checkpoint.jobs,complete:Boolean(checkpoint.complete),...(checkpoint.complete&&{totals:catalog.totals(factory)})}));
   }finally{await connection.query('ROLLBACK');}
   await wait(120);
  }
  if(!catalog.statusesChecked(factory)){
   let cursor='',checked=0;
   for(;;){
    const ids=catalog.jobsWithoutStatuses(factory,cursor,pageSize);
    if(!ids.length)break;
    await connection.query('START TRANSACTION READ ONLY');
    try{
     const [jobs]=await connection.execute(`SELECT id,job_code,status FROM ${database}.bjob WHERE id IN (${ids.map(()=>'?').join(',')})`,ids);
     catalog.commit(factory,checkpoint,ids,await readBatch(connection,factory,jobs));
     checkpoint=catalog.progress(factory);
    }finally{await connection.query('ROLLBACK');}
    checked+=ids.length;
    cursor=ids.at(-1);
   }
   catalog.markStatusesChecked(factory);
   console.log(JSON.stringify({factory,historyVerified:true,checked,totals:catalog.totals(factory)}));
  }
  if(process.argv.includes('--backfill-only'))return;
  while(true){
   await connection.query('START TRANSACTION READ ONLY');
   let changed=0;
   try{
    const [[[at,timeFrom]]]=await connection.execute("SELECT DATE_FORMAT(NOW(),'%Y-%m-%d %H:%i:%s'),DATE_FORMAT(DATE_SUB(?,INTERVAL 10 MINUTE),'%Y-%m-%d %H:%i:%s')",[checkpoint.seen_at]);
    const [impacted]=await connection.execute(`SELECT /*+ MAX_EXECUTION_TIME(15000) */ id FROM ${database}.bjob WHERE created_at>=? OR modified_at>=? OR job_edited_at>=?
     UNION SELECT jobid FROM ${database}.job_oper WHERE modified_at>=? OR created_at>=?
     UNION SELECT jobid FROM ${database}.job_mat WHERE rp_work_at>=? OR modified_at>=?
     UNION SELECT j.jobid FROM ${database}.plan_item_job j JOIN ${database}.plan_item p ON p.id=j.plan_item_id WHERE p.modified_at>=? OR j.modified_at>=? OR j.created_at>=?`,Array(10).fill(timeFrom));
    const ids=impacted.map(row=>row[0]).filter(id=>typeof id==='string'&&id);
    for(let offset=0;offset<ids.length;offset+=pageSize){
     const segment=ids.slice(offset,offset+pageSize);
     const [jobs]=await connection.execute(`SELECT id,job_code,status FROM ${database}.bjob WHERE id IN (${segment.map(()=>'?').join(',')})`,segment);
     const rows=await readBatch(connection,factory,jobs);
     changed+=catalog.commit(factory,checkpoint,segment,rows);
     checkpoint=catalog.progress(factory);
    }
    catalog.commit(factory,{...checkpoint,seen_at:at},[],[]);
    checkpoint=catalog.progress(factory);
    console.log(JSON.stringify({factory,incremental:true,checked:ids.length,changed,version:checkpoint.version}));
   }finally{await connection.query('ROLLBACK');}
   await wait(60000);
  }
 }finally{await connection.end();}
}

await Promise.all(catalogFactories.map(async factory=>{
 for(;;){
  try{await syncFactory(factory);break;}
  catch(error){console.error(JSON.stringify({factory,problem:error.code||error.message}));if(process.argv.includes('--backfill-only'))throw error;await wait(15000);}
 }
})).finally(()=>catalog.close());
