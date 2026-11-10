import * as XLSX from 'xlsx';
import type {AppState} from './scheduler-app';

export type MasterDataKind='parts'|'workers';
type Part=AppState['parts'][number];
type Worker=AppState['workers'][number];

const formats={
 parts:{name:'工件定额',headers:['物料编码','工件名称','图号','加工类别','单件工时','工厂'],notes:[
  ['物料编码','必填。相同编码更新已有工件；有前导零时请按文本填写。'],
  ['工件名称、单件工时','新增工件必填，工时填正数，单位与现有工件定额一致。'],
  ['图号、加工类别','建议填写。图号请按文本填写，加工类别尽量使用现有名称。'],
 ]},
 workers:{name:'人员产能',headers:['姓名','班组','标准日产能','加班日产能','加工类别','工厂'],notes:[
  ['姓名','必填。与已有人员的姓名一致时更新该人员；有同名人员时请在页面单独修改。'],
  ['标准日产能、加班日产能','填写与页面相同单位的数值。加班日产能不能低于标准日产能。'],
  ['班组、加工类别','加工类别可以用顿号或逗号分隔，填写后会替换原加工类别。'],
  ['仅导入名单','新人员只填写姓名也可保存，未填写标准日产能时处于待确认状态。'],
 ]},
};

const clean=(value:unknown)=>String(value??'').trim();

export function buildMasterDataTemplate(kind:MasterDataKind){
 const {name,headers,notes}=formats[kind];
 const book=XLSX.utils.book_new();
 const sheet=XLSX.utils.aoa_to_sheet([headers]);
 sheet['!cols']=headers.map(()=>({wch:18}));
 XLSX.utils.book_append_sheet(book,sheet,name);
 const instructions=XLSX.utils.aoa_to_sheet([
  ['字段','填写要求'],...notes,
  ['工厂','可留空。填写时请用西安或兴平，并与当前页面工厂一致。'],
  ['导入方式','把资料填入第一张表，不要改表头。更新已有资料时，留空的字段保留原值。'],
 ]);
 instructions['!cols']=[27,82].map(wch=>({wch}));
 XLSX.utils.book_append_sheet(book,instructions,'填写说明');
 return book;
}

function workbookRows(kind:MasterDataKind,book:XLSX.WorkBook,factory:string){
 const {name,headers}=formats[kind],key=headers[0];
 const sheet=book.Sheets[book.SheetNames[0]],reference=sheet?.['!ref'];
 if(!reference)throw new Error('工作表为空，请使用下载的模板。');
 const range=XLSX.utils.decode_range(reference);
 if(range.e.r>10000||range.e.c>63)throw new Error('请使用模板，每次最多导入 10,000 行资料。');
 const [header=[],...rows]=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,range:0,defval:'',blankrows:true});
 const columns=header.map(clean);
 if(!columns.includes(key))throw new Error(`第一张表缺少「${key}」列，请使用${name}模板。`);
 const unexpected=columns.find(column=>column&&!headers.includes(column));
 if(unexpected)throw new Error(`第一张表含有「${unexpected}」列，请使用${name}模板。`);
 const named=columns.filter(Boolean);
 if(new Set(named).size!==named.length)throw new Error('第一张表有重复列名，请核对模板。');
 const seen=new Set<string>();
 const entries=rows.flatMap((row,i)=>{
  if(!row.some(cell=>clean(cell)))return [];
  const fail=(message:string):never=>{throw new Error(`第 ${i+2} 行：${message}`);};
  if(row.some((cell,column)=>clean(cell)&&!columns[column]))fail('有数据填在无表头的列中。');
  const value=(column:string)=>clean(row[columns.indexOf(column)]);
  const id=value(key),site=value('工厂');
  if(!id)fail(`请填写${key}。`);
  if(seen.has(id))fail(`${key}「${id}」重复，请合并后再导入。`);
  seen.add(id);
  if(site&&site.replace(/工厂$/,'')!==factory.replace(/工厂$/,''))fail(`表中工厂为${site}，当前为${factory}，请核对后再导入。`);
  const number=(column:string)=>{
   const input=value(column);
   if(!input)return undefined;
   const result=Number(input);
   if(!/^\d+(?:\.\d+)?$/.test(input)||!Number.isFinite(result)||result<0||(column==='单件工时'&&result===0))fail(`「${column}」须填写${column==='单件工时'?'正数':'非负数'}。`);
   return result;
  };
  return [{id,value,number,fail}];
 });
 if(!entries.length)throw new Error('第一张表没有可导入的资料。');
 return entries;
}

function mergeRows<T>(current:T[],entries:ReturnType<typeof workbookRows>,key:(item:T)=>string,patch:(row:ReturnType<typeof workbookRows>[number],existing?:T)=>T){
 const indexes=new Map<string,number>();
 current.forEach((item,index)=>{
  const id=key(item).trim();
  indexes.set(id,indexes.has(id)?-1:index);
 });
 const result=[...current];
 let added=0,updated=0;
 for(const row of entries){
  const index=indexes.get(row.id);
  if(index===-1)row.fail(`现有资料有同名或同编码的「${row.id}」，请先在页面核对。`);
  if(index===undefined){result.push(patch(row));added++}
  else{result[index]=patch(row,current[index]);updated++}
 }
 return {result,added,updated};
}

export function applyMasterDataWorkbook<T extends Pick<AppState,'parts'|'workers'>>(state:T,kind:MasterDataKind,book:XLSX.WorkBook,factory:string){
 const entries=workbookRows(kind,book,factory);
 if(kind==='parts'){
  const {result,added,updated}=mergeRows<Part>(state.parts,entries,part=>part.code,(row,existing)=>{
   const name=row.value('工件名称')||existing?.name;
   const unit=row.number('单件工时');
   if(!name)row.fail('请填写工件名称。');
   if(!existing&&unit===undefined)row.fail('新增工件须填写单件工时。');
   return {
    ...existing,id:existing?.id||crypto.randomUUID(),code:row.id,workers:existing?.workers||[],operationCode:existing?.operationCode||'TURN',processMode:existing?.processMode||'internal',
    name:name!,drawingNo:row.value('图号')||existing?.drawingNo,
    category:row.value('加工类别')||existing?.category||'',unit:unit??existing?.unit??0,
   };
  });
  return {next:{...state,parts:result},added,updated};
 }
 const {result,added,updated}=mergeRows<Worker>(state.workers,entries,worker=>worker.name,(row,existing)=>{
  const standard=row.number('标准日产能'),capacity=standard??existing?.capacity??0;
  const extra=row.number('加班日产能');
  if(extra!==undefined&&extra<capacity)row.fail('加班日产能不能低于标准日产能。');
  const overtime=extra??(standard===undefined?(existing?.overtime??capacity):Math.max(capacity,existing?.overtime??0));
  const skills=row.value('加工类别');
  return {
   ...existing,id:existing?.id||crypto.randomUUID(),name:existing?.name||row.id,
   team:row.value('班组')||existing?.team||'车工组',capacity,overtime,
   skills:skills?[...new Set(skills.split(/[、,，；;\n]/).map(clean).filter(Boolean))]:existing?.skills||[],
   active:standard===undefined?(existing?.active??false):capacity>0&&(!existing||existing.active||existing.capacity===0),
  };
 });
 return {next:{...state,workers:result},added,updated};
}
