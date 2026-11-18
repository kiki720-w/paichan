import {useEffect,useState} from 'react';
import type {Allocation,ScheduleShortage} from './scheduler-app';

type CatalogRow={operationId:string;workOrder:string;operationNo:string;operationName:string;jobStatus?:string;operationStatus?:string;partCode?:string;partName?:string;due?:string;planned:number|null;completed:number;pendingReports:number;requiresReview:boolean;status:string};
type Draft={id:string;generatedAt:string;status:'draft'|'confirmed'|'published';retained:number;allocationCount:number;allocations:Allocation[];shortages:ScheduleShortage[];shortageCount:number;blocked:number;matchedOperations?:number;unpublishedRows?:Allocation[];withdrawnPlan?:boolean;confirmedBy?:string;publishedBy?:string};
type Catalog={complete:boolean;jobs:number;syncedAt:string|null;totals:Record<string,number>;rows:CatalogRow[];next:string|null;draft:Draft|null};

const labels={pending:'待排池',complete:'历史完工',review:'待核对'};
const rowReason=(row:CatalogRow)=>!row.workOrder||row.workOrder==='NULL'?'缺工单号':row.pendingReports>0?'报工待确认':row.planned===null||row.planned<=0?'缺有效计划量':row.completed>row.planned||row.completed<0?'完工量异常':row.requiresReview?'MES 工序待确认':(row.jobStatus==='3'||row.operationStatus==='2')&&row.completed<row.planned?'MES 已结案或工序已关闭，数量待核对':!row.partCode?'缺物料编码':'—';

function DispatchPreview({rows,label,open=false}:{rows:Allocation[];label:string;open?:boolean}){
 return <details open={open}><summary>{label}</summary><div className="table-wrap capped-table"><table><thead><tr><th>日期</th><th>工单</th><th>物料</th><th>人员</th><th>设备</th><th>工作量</th></tr></thead><tbody>{rows.map((row,index)=><tr key={index}><td>{row.date}</td><td>{row.orderNo}</td><td>{row.partCode}</td><td>{row.worker}</td><td>{row.machineName||'—'}</td><td>{Number(row.amount.toFixed(4))}</td></tr>)}</tbody></table></div></details>;
}

export function MesCatalogPanel({factory,mode,onPublished}:{factory:string;mode:'orders'|'draft';onPublished?:()=>void}){
 const [filter,setFilter]=useState<keyof typeof labels>('pending'),[search,setSearch]=useState('');
 const [pages,setPages]=useState<string[]>([]),[catalog,setCatalog]=useState<Catalog|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
 const after=pages.at(-1);
 useEffect(()=>{
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>;
  async function load(){
   try{
    const params=new URLSearchParams({factory,status:filter,q:search,view:mode,...(after&&{after})});
    const response=await fetch('/api/mes-catalog?'+params,{signal:controller.signal});
    if(!response.ok)throw Error('暂时无法读取 MES 工单目录');
    const result=await response.json();
    if(!controller.signal.aborted)setCatalog(result);
   }catch(error){if(!controller.signal.aborted)setNotice(error instanceof Error?error.message:'读取失败');}
   if(!controller.signal.aborted)timer=setTimeout(load,5000);
  }
  timer=setTimeout(load,search?200:0);
  return ()=>{controller.abort();clearTimeout(timer);};
 },[factory,filter,search,after,refresh,mode]);

 async function move(action:'confirm'|'publish'){
  if(!catalog?.draft||busy)return;
  setBusy(true);setNotice('');
  try{
   const params=new URLSearchParams({factory,action,draft:catalog.draft.id});
   const response=await fetch('/api/mes-catalog?'+params,{method:'POST'});
   const result=await response.json();
   if(!response.ok)throw Error(result.error);
   setNotice(action==='confirm'?'草稿已确认，可以发布。':'新版派工已发布。');
   if(action==='publish')onPublished?.();
  }catch(error){setNotice(error instanceof Error?error.message:'操作失败');}
  finally{setBusy(false);setRefresh(value=>value+1);}
 }

 if(mode==='draft'){
  const draft=catalog?.draft;
  const inherited=draft?.unpublishedRows||[];
  return <section className="panel" aria-label="MES 自动排产草稿">
   <div className="panel-title"><h3>MES 自动排产草稿</h3>{draft&&<span className={draft.status==='published'?'ok':'pending'}>{draft.status==='published'?'已发布':draft.status==='confirmed'?'已确认':'待人工确认'}</span>}</div>
   {!draft?<p>{catalog?.complete?'正在生成本厂草稿…':'全量同步完成后生成草稿。'}</p>:<>
    <p className="compact-note">{new Date(draft.generatedAt).toLocaleString('zh-CN')} · 保留 {draft.retained} 条{inherited.length?'已有':'已发布'}派工 · 本次新增 {draft.allocationCount} 条 · {draft.shortageCount} 道工序有产能缺口</p>
    {draft.withdrawnPlan&&<p className="import-issues">当前计划已经撤回，发布前请先核对撤回的派工。</p>}
    {draft.blocked>0&&<p className="compact-note">{draft.blocked} 道工序因资料不足未纳入派工。</p>}
    {!draft.allocationCount&&<p>{draft.matchedOperations===0?'现有车工定额没有匹配到本厂待排工序。':'当前没有可发布的新增派工。'} 待排池可查看未完工工序。</p>}
    {!!draft.allocations.length&&<DispatchPreview rows={draft.allocations} label="查看新增派工" open/>}
    {!!inherited.length&&<><p className="compact-note">本版包含 {inherited.length} 条已有草稿派工。人工确认并发布本版后，这些派工随本版生效。</p><DispatchPreview rows={inherited} label="查看已有草稿派工"/></>}
    {!!draft.shortages.length&&<details><summary>查看产能缺口</summary><ul>{draft.shortages.map((row,index)=><li key={index}>{row.orderNo} · {row.partCode} · 待排 {Number(row.remainingQty.toFixed(4))} 件</li>)}</ul></details>}
    {draft.confirmedBy&&<p className="compact-note">确认人 {draft.confirmedBy}{draft.publishedBy&&` · 发布人 ${draft.publishedBy}`}</p>}
    {draft.status!=='published'&&<button type="button" className="primary" disabled={busy||!draft.allocationCount||draft.withdrawnPlan} onClick={()=>move(draft.status==='draft'?'confirm':'publish')}>{draft.status==='draft'?(inherited.length?'确认合并草稿':'确认 MES 草稿'):'发布 MES 草稿'}</button>}
   </>}
   {notice&&<p role="status">{notice}</p>}
  </section>;
 }

 return <section className="panel" aria-label="MES 全量工单">
  <div className="panel-title"><div><h3>MES 全量工单</h3><small>{catalog?`${catalog.complete?'全量已同步':'正在补齐历史'} · 已扫描 ${catalog.jobs.toLocaleString('zh-CN')} 张工单`:'正在读取本厂 MES 记录…'}</small></div></div>
  <div className="order-filter-chips" aria-label="MES 工单状态">{(Object.keys(labels) as (keyof typeof labels)[]).map(key=><button type="button" key={key} aria-pressed={filter===key} onClick={()=>{setFilter(key);setPages([]);}}>{labels[key]}{catalog?.complete&&<span>{(catalog.totals[key]||0).toLocaleString('zh-CN')}</span>}</button>)}</div>
  <label>工单或物料编码 <input type="search" value={search} placeholder="输入完整编码或开头几位" onChange={event=>{setSearch(event.target.value);setPages([]);}}/></label>
  {catalog&&<><div className="table-wrap capped-table"><table><thead><tr><th>工单 / 工序</th><th>物料</th><th>计划量</th><th>完工量</th><th>交期</th>{filter==='review'&&<th>暂缓原因</th>}</tr></thead><tbody>{catalog.rows.map(row=><tr key={row.operationId}><td><b>{row.workOrder}</b><small className="cell-note">{row.operationNo} {row.operationName}</small></td><td>{row.partCode||'—'}<small className="cell-note">{row.partName}</small></td><td>{row.planned??'—'}</td><td>{row.completed}</td><td>{row.due||'—'}</td>{filter==='review'&&<td>{rowReason(row)}</td>}</tr>)}</tbody></table></div>
   {!catalog.rows.length&&<p>没有匹配记录。</p>}
   <div className="row"><button type="button" className="import" disabled={!pages.length} onClick={()=>setPages(current=>current.slice(0,-1))}>上一页</button><span>第 {pages.length+1} 页</span><button type="button" className="import" disabled={!catalog.next} onClick={()=>catalog.next&&setPages(current=>[...current,catalog.next!])}>下一页</button></div>
  </>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
