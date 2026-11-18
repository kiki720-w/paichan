const databases={xian:'db00xadl',xingping:'db00xpdl'} as const;
type Factory=keyof typeof databases;

export function buildMesOperationPreviewQuery(factory:Factory,workOrders:string[],includeRecent=false,checkpoint?:{cursor:string;since?:string;batchSize?:number;cutoff?:string;scanOlder?:boolean},trackedWorkOrders?:readonly string[],jobIds?:readonly string[]){
 const db=databases[factory];
 if(!db||(!workOrders.length&&!includeRecent&&!jobIds)||workOrders.length>30||workOrders.some(code=>!/^[A-Z0-9-]{1,40}$/.test(code)))throw Error('联调工厂或工单号无效');
 if(jobIds&&(!jobIds.length||jobIds.length>6000||jobIds.some(id=>!/^[a-zA-Z0-9-]{1,60}$/.test(id))))throw Error('工单分页标识无效');
 if(trackedWorkOrders?.some(code=>!/^[A-Z0-9-]{1,60}$/.test(code)))throw Error('序衡已同步工单号无效');
 const codes=[...new Set([...workOrders,...(trackedWorkOrders||[])])].map(code=>`'${code}'`).join(',');
 const timestamp=/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/;
 if(checkpoint&&(!/^[a-zA-Z0-9-]*$/.test(checkpoint.cursor)||(checkpoint.since&&!timestamp.test(checkpoint.since))||(checkpoint.cutoff&&!timestamp.test(checkpoint.cutoff))))throw Error('本地同步位置无效');
 const since=checkpoint?.since?`LEAST(NOW() - INTERVAL 1 DAY, '${checkpoint.since}' - INTERVAL 1 HOUR)`:'NOW() - INTERVAL 1 DAY';
 const batchSize=checkpoint?.batchSize??100;
 if(!Number.isInteger(batchSize)||batchSize<1||batchSize>6000)throw Error('从库分页大小无效');
 const cutoff=checkpoint?.cutoff?`'${checkpoint.cutoff}'`:'NOW()-INTERVAL 1 DAY';
 const scanOlder=checkpoint&&checkpoint.scanOlder!==false;
 const older=scanOlder?`SELECT id,job_code FROM ${db}.bjob FORCE INDEX (PRIMARY) WHERE id > '${checkpoint.cursor}' AND status=0 AND job_status IN (0,1,2) AND created_at<${cutoff} ORDER BY id LIMIT ${batchSize}`:'';
 const open=`SELECT scan.id,scan.job_code FROM (${older}) scan WHERE EXISTS (SELECT 1 FROM ${db}.job_oper pending WHERE pending.jobid=scan.id AND pending.status=0 AND pending.job_oper_status IN (0,1))`;
 const jobs=jobIds?`(SELECT id,job_code FROM ${db}.bjob WHERE id IN (${jobIds.map(id=>`'${id}'`).join(',')}))`:checkpoint?.cutoff?`(${open})`:includeRecent?`(SELECT id,job_code FROM ${db}.bjob WHERE created_at >= ${since}
  ${codes?`UNION SELECT id,job_code FROM ${db}.bjob WHERE job_code IN (${codes})`:''}
  ${checkpoint?`UNION SELECT b.id,b.job_code FROM (SELECT DISTINCT jobid FROM ${db}.job_mat WHERE rp_work_at >= ${since} AND rp_work_at <= NOW()) changed JOIN ${db}.bjob b ON b.id=changed.jobid WHERE b.status=0
  ${scanOlder?`UNION ${open}`:''}`:''})`:`${db}.bjob`;
 const metadata=trackedWorkOrders?`, HEX(pi.part_code),HEX(pi.part_name),HEX(COALESCE(NULLIF(o.drawing_no,''),pi.part_no)),
   DATE_FORMAT(COALESCE(NULLIF(pi.plan_finish_time,'1970-01-01 00:00:00'),NULLIF(pi.delivery_date,'1970-01-01 00:00:00')),'%Y-%m-%d'),
   HEX(COALESCE(NULLIF(header.client_full_name,''),pi.client_full_name)),HEX(m.part_name),HEX(m.part_no), header.created_at>=${since}${jobIds?',b.id,header.job_status,o.job_oper_status':''}`:'';
 const plan=trackedWorkOrders?`JOIN ${db}.bjob header ON header.id=b.id AND header.status=0
   LEFT JOIN ${db}.plan_item pi ON pi.id=(SELECT IF(COUNT(DISTINCT j.plan_item_id)=1,MIN(j.plan_item_id),NULL)
   FROM ${db}.plan_item_job j WHERE j.jobid=header.id AND j.status=0)` : '';
 const rows=`SELECT /*+ MAX_EXECUTION_TIME(10000) */ '${factory}' AS factory, b.job_code, o.id AS operation_id, o.oper_no,
   HEX(o.oper_name) AS operation_name, o.plan_num, m.part_code, m.id AS report_id,
   DATE_FORMAT(m.report_at,'%Y-%m-%d %H:%i:%s') AS report_at, m.rp_work_num, m.ejec_type, m.status, m.cancel_status${metadata}
  FROM ${jobs} b STRAIGHT_JOIN ${db}.job_oper o FORCE INDEX (jobid) ON o.jobid=b.id
  ${plan}
  LEFT JOIN ${db}.job_mat m FORCE INDEX (job_oper_id) ON m.job_oper_id=o.id AND m.rp_work_num IS NOT NULL
  WHERE ${includeRecent||checkpoint?.cutoff||jobIds?'':`b.job_code IN (${codes}) AND `}o.status=0;`;
 return scanOlder?`SELECT /*+ MAX_EXECUTION_TIME(10000) */ 'checkpoint','${factory}',IF(COUNT(*)=${batchSize},MAX(id),''),DATE_FORMAT(NOW(),'%Y-%m-%d %H:%i:%s'),COUNT(*) FROM (${older}) scan;\n${rows}`:rows;
}

export function readMesOperationPreview(input:string|string[][]){
 const operations=new Map<string,{factory:string;workOrder:string;jobId?:string;jobStatus?:string|null;operationStatus?:string|null;operationId:string;operationNo:string;operationName:string;planned:number|null;groups:Map<string,number[]>;unresolved:number;
  metadata?:{partCode:string;partName:string;drawingNo:string;due:string;customer:string;recent:boolean;reportedParts:Map<string,{name:string;drawingNo:string}>}}>();
 const decode=(value:string)=>value==='NULL'?'':Buffer.from(value,'hex').toString('utf8');
 const columns=typeof input==='string'?input.split(/\r?\n/).filter(Boolean).map(line=>line.split('\t')):input;
 for(const line of columns){
  const [factory,workOrder,operationId,operationNo,operationHex,plan,part,reportId,reportedAt,quantity,,status,canceled,partCode,partName,drawingNo,due,customer,reportedName,reportedDrawing,recent,jobId,jobStatus,operationStatus]=line;
  if(!['xian','xingping'].includes(factory)||!operationId||canceled===undefined)throw Error('从库联调结果格式无效');
  const key=JSON.stringify([factory,operationId]);
  if(!operations.has(key))operations.set(key,{factory,workOrder,...(jobId&&{jobId,jobStatus:jobStatus==='NULL'?null:jobStatus,operationStatus:operationStatus==='NULL'?null:operationStatus}),operationId,operationNo,operationName:decode(operationHex),planned:plan==='NULL'?null:Number(plan),groups:new Map(),unresolved:0,
   ...(recent!==undefined&&{metadata:{partCode:decode(partCode),partName:decode(partName),drawingNo:decode(drawingNo),due:due==='NULL'?'':due,customer:decode(customer),recent:recent==='1',reportedParts:new Map()}})});
  const operation=operations.get(key)!;
  if(reportId==='NULL')continue;
  if(operation.metadata&&part&&part!=='NULL'&&status==='0'&&canceled==='NULL')operation.metadata.reportedParts.set(part,{name:decode(reportedName),drawingNo:decode(reportedDrawing)});
  if(reportedAt==='NULL'){operation.unresolved++;continue;}
  const reportKey=JSON.stringify([part,reportedAt]);
  const rows=operation.groups.get(reportKey)||[];
  rows.push(status==='0'&&canceled==='NULL'&&quantity.trim()?Number(quantity):NaN);
  operation.groups.set(reportKey,rows);
 }
 const counts=new Map<string,number>();
 const numberKey=(operation:{factory:string;workOrder:string;jobId?:string;operationNo:string})=>JSON.stringify([operation.factory,operation.jobId||operation.workOrder,operation.operationNo]);
 for(const operation of operations.values()){
  const key=numberKey(operation);
  counts.set(key,(counts.get(key)||0)+1);
 }
 return [...operations.values()].map(({groups,unresolved,metadata,...operation})=>{
  let reported=0,withheldGroups=0;
  for(const quantities of groups.values()){
   if(quantities.length!==1||!Number.isFinite(quantities[0])||quantities[0]<0){withheldGroups++;continue;}
   reported+=quantities[0];
  }
  const sameNumber=(counts.get(numberKey(operation))||0)>1;
  const partCode=metadata?.partCode||(!metadata||metadata.reportedParts.size!==1?'':metadata.reportedParts.keys().next().value||'');
  const reportedPart=metadata?.reportedParts.get(partCode);
  const conflictingPart=metadata&&(metadata.reportedParts.size>1||(metadata.reportedParts.size===1&&!reportedPart));
  return {...operation,reported,withheldGroups,unresolved,sameNumber,readyForReview:!sameNumber&&!conflictingPart&&withheldGroups===0&&unresolved===0&&operation.planned!==null&&reported<=operation.planned,
   ...(metadata&&{orderMetadata:{partCode,partName:metadata.partName||reportedPart?.name||'',drawingNo:metadata.drawingNo||reportedPart?.drawingNo||'',due:metadata.due,customer:metadata.customer,recent:metadata.recent}})};
 });
}
