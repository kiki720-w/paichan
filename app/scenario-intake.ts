import * as XLSX from 'xlsx';
import type {AppState} from './scheduler-app';
import type {SchedulingScenario} from './scheduling-scenarios';
import {validCalendarDate} from './production-calendar';

export const intakeKeys=['工厂','情景','工单号','物料编码','人员','数量','交期','开始日期','结束日期'] as const;
type IntakeKey=typeof intakeKeys[number];
export type IntakeField={key:IntakeKey;value:string;confidence:number|null};
const factories:Record<string,string>={xian:'西安',xingping:'兴平'};
const modes={紧急插单:'insert',人员请假:'leave',调整交期:'due'} as const;

export function buildScenarioTemplate(factory:string){
 const book=XLSX.utils.book_new();
 const data=XLSX.utils.aoa_to_sheet([[...intakeKeys]]);
 data['!cols']=intakeKeys.map(()=>({wch:16}));
 XLSX.utils.book_append_sheet(book,data,'情景数据');
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([
  ['字段','填写说明'],['工厂',factories[factory]],['情景','紧急插单、人员请假、调整交期三选一'],
  ['紧急插单','填工单号、物料编码、数量、交期'],
  ['人员请假','填人员、开始日期、结束日期'],
  ['调整交期','填原工单号、物料编码和新交期。工单号和物料应唯一对应。'],
  ['日期','格式 YYYY-MM-DD；第一张表只能有一条情景。'],
 ]),'填写说明');
 return book;
}

function fieldDate(raw:unknown){
 if(typeof raw==='number'){
  const parsed=XLSX.SSF.parse_date_code(raw);
  if(parsed)return [String(parsed.y),String(parsed.m).padStart(2,'0'),String(parsed.d).padStart(2,'0')].join('-');
 }
 const clean=String(raw??'').trim();
 const date=clean.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})日?$/);
 return date?[date[1],date[2].padStart(2,'0'),date[3].padStart(2,'0')].join('-'):clean;
}

function checkFactory(value:string,factory:string){
 if(!factories[factory]||![factory,factories[factory],factories[factory]+'工厂'].includes(value))throw Error('附件工厂必须与当前工厂相同。');
}

export function readScenarioWorkbook(file:ArrayBuffer,factory:string):IntakeField[]{
 const book=XLSX.read(file,{type:'array'});
 const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(book.Sheets[book.SheetNames[0]],{defval:''});
 if(rows.length!==1||!Object.keys(rows[0]).includes('情景'))throw Error('请用情景 Excel 模板填写一条记录，保留列名。');
 const row=rows[0];
 checkFactory(String(row.工厂??'').trim(),factory);
 return intakeKeys.map(key=>({key,value:key.endsWith('日期')||key==='交期'?fieldDate(row[key]):String(row[key]??'').trim(),confidence:null}));
}

export function scanScenarioFields(text:string,confidence:number|null):IntakeField[]{
 const fields=new Map<string,string[]>();
 for(const line of text.normalize('NFKC').split(/\r?\n/)){
  const match=line.trim().match(/^([^:]{1,12}):\s*(.*?)\s*$/);
  if(!match)continue;
  const key=match[1].replace(/\s+/g,''),value=match[2].trim();
  fields.set(key,[...(fields.get(key)||[]),value]);
 }
 return intakeKeys.map(key=>{
  const found=fields.get(key);
  const value=found?.length===1?found[0]:'';
  return {key,value:key.endsWith('日期')||key==='交期'?fieldDate(value):value,confidence:value?confidence:null};
 });
}

export function scenarioFromFields(fields:IntakeField[],state:Pick<AppState,'orders'|'workers'>,factory:string):SchedulingScenario{
 const value=(key:IntakeKey)=>fields.find(field=>field.key===key)?.value.trim()||'';
 checkFactory(value('工厂'),factory);
 const mode=value('情景') as keyof typeof modes;
 if(!Object.hasOwn(modes,mode))throw Error('情景须为紧急插单、人员请假或调整交期。');
 const event=modes[mode];
 if(event==='leave'){
  const workers=state.workers.filter(worker=>worker.active&&worker.name===value('人员'));
  const start=fieldDate(value('开始日期')),end=fieldDate(value('结束日期'));
  if(workers.length!==1)throw Error('请填写能唯一匹配的本厂在岗人员姓名。');
  if(!validCalendarDate(start)||!validCalendarDate(end)||end<start)throw Error('请核对请假日期。');
  return {kind:event,workerId:workers[0].id,start,end};
 }
 const orderNo=value('工单号'),partCode=value('物料编码'),due=fieldDate(value('交期'));
 if(!orderNo||!validCalendarDate(due))throw Error('请检查工单号与交期。');
 if(event==='due'){
  const orders=state.orders.filter(order=>order.orderNo===orderNo&&(!partCode||order.partCode===partCode));
  if(orders.length!==1)throw Error('工单号与物料必须唯一对应本厂订单。');
  return {kind:event,orderId:orders[0].id,due};
 }
 const quantity=Number(value('数量'));
 if(!partCode||!Number.isFinite(quantity)||quantity<=0)throw Error('请检查物料编码与数量。');
 return {kind:event,orderNo,partCode,due,quantity};
}
