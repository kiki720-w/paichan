import {useEffect,useState} from 'react';
import type {DraftAdjustment,ScenarioDraft,ScenarioOption} from './scenario-drafts';
import type {Worker} from './scheduler-app';
import type {SchedulingScenarioResult} from './scheduling-scenarios';
import {ScenarioPolicyPanel} from './scenario-policy-panel';
import type {ScenarioPolicy} from './scenario-policy';

type DraftSummary=Omit<ScenarioDraft,'rows'|'events'>;
const label={draft:'待确认',confirmed:'已确认',published:'已发布',restored:'已恢复'};
const subject=(draft:DraftSummary)=>draft.input.kind==='insert'?draft.input.orderNo:draft.input.kind==='due'?'交期调整':draft.input.kind==='split'?'分批交付':'人员请假';

export function ScenarioDraftsPanel({factory,revision,day,view,onEdit,onPlanChange,editing,workers}:{
 factory:string;revision:number;day:string;view:SchedulingScenarioResult|null;
 onEdit:(draft:ScenarioDraft|null)=>void;onPlanChange:()=>Promise<unknown>;editing:ScenarioDraft|null;workers:Worker[];
}){
 const endpoint='/api/scenario-drafts?factory='+factory;
 const [list,setList]=useState<DraftSummary[]>([]),[selected,setSelected]=useState<ScenarioDraft|null>(null);
 const [option,setOption]=useState<ScenarioOption>('normal'),[reason,setReason]=useState('');
 const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
 const [policy,setPolicy]=useState<ScenarioPolicy|null>(null),[autoNotice,setAutoNotice]=useState('');
 const [move,setMove]=useState<DraftAdjustment|null>(null);
 useEffect(()=>{
  const controller=new AbortController();
  async function load(){
   try{
    const response=await fetch(endpoint,{signal:controller.signal,cache:'no-store'});
    const result=await response.json();
    if(!response.ok)throw Error(result.message||'草稿读取失败。');
    if(!controller.signal.aborted){setList(result.drafts);setPolicy(result.policy);}
   }catch(error){if(!controller.signal.aborted)setNotice((error as Error).message);}
  }
  void load();
  return ()=>controller.abort();
 },[endpoint,refresh]);
 const policyVersion=policy?.enabled?policy.version:0;
 const fresh=view&&view.revision===revision&&view.start===day;
 const selectedOption=option==='alternate'&&view?.alternate||option==='overtime'&&view?.overtime?option:'normal';
 useEffect(()=>{
  if(!policyVersion||!fresh||!view||editing)return;
  const controller=new AbortController();
  async function automatic(){
   try{
    const response=await fetch(endpoint,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({
     action:'automatic',baseRevision:revision,day,input:view?.scenario,
    })});
    const result=await response.json();
    if(!response.ok)throw Error(result.message||'自动保存失败。');
    if(!controller.signal.aborted){
     setAutoNotice('已按策略保存方案，可在情景草稿中查看。');
     setRefresh(count=>count+1);
    }
   }catch(error){if(!controller.signal.aborted)setAutoNotice('请人工处理。'+(error as Error).message);}
  }
  void automatic();
  return ()=>controller.abort();
 },[endpoint,policyVersion,fresh,view,editing,revision,day]);
 async function savePolicy(settings:ScenarioPolicy){
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
   action:'policy',policyVersion:settings.version,policy:settings,
  })});
  const result=await response.json();
  if(!response.ok)throw Error(result.message||'策略保存失败。');
  setPolicy(result.policy);setNotice('已保存自动处理策略。');
 }
 async function open(id:string){
  setBusy(true);setNotice('');setReason('');setMove(null);
  try{
   const response=await fetch(endpoint+'&id='+encodeURIComponent(id),{cache:'no-store'});
   const result=await response.json();
   if(!response.ok)throw Error(result.message||'草稿读取失败。');
   setSelected(result.draft);
  }catch(error){setNotice((error as Error).message);}
  finally{setBusy(false);}
 }
 async function save(action:'create'|'edit'|'adjust'|'confirm'|'publish'|'restore'){
  const target=action==='edit'?editing:selected;
  if(busy)return;
  setBusy(true);setNotice('');
  try{
   const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    action,id:target?.id,draftRevision:target?.revision,baseRevision:revision,
    day,input:view?.scenario,option:selectedOption,reason,move,
   })});
   const result=await response.json();
   if(!response.ok)throw Error(result.message||'操作未保存。');
   setSelected(result.draft);setReason('');setMove(null);setRefresh(count=>count+1);onEdit(null);
   setNotice(action==='publish'?'新计划已发布。':action==='restore'?'已恢复发布前计划。':'草稿已保存。');
   if(action==='publish'||action==='restore')await onPlanChange();
  }catch(error){setNotice((error as Error).message);}
  finally{setBusy(false);}
 }
 const canConfirm=selected?.baseRevision===revision&&selected?.day===day;
 const needsReason=selected?.input.kind==='due'||selected?.input.kind==='split'||selected?.option==='overtime';
 const canAdjust=canConfirm&&selected?.input.kind!=='split'&&(selected?.status==='draft'||selected?.status==='confirmed');
 return <section className="panel" aria-label="情景草稿">
  <div className="panel-title"><div><h3>情景草稿</h3><small>最近更新的 30 份</small></div></div>
  {policy&&<details><summary>自动保存策略 · {policy.enabled?'已启用':'已停用'}</summary><ScenarioPolicyPanel key={policy.version} policy={policy} onSave={savePolicy}/></details>}
  {fresh&&policyVersion>0&&autoNotice&&<p role="status">{autoNotice}</p>}
  {editing&&<p className="compact-note">正在编辑 {subject(editing)}。修改上方情景并重新试算后保存。</p>}
  {fresh&&<div className="compact-toolbar">
   <label>保存方案 <select value={selectedOption} onChange={event=>setOption(event.target.value as ScenarioOption)}><option value="normal">情景正常班</option>
    {view.overtime&&<option value="overtime">情景含加班</option>}{view.alternate&&<option value="alternate">平衡人员负荷</option>}
   </select></label>
   <button className="primary" type="button" disabled={busy} onClick={()=>void save(editing?'edit':'create')}>{editing?'保存草稿修改':'保存为草稿'}</button>
  </div>}
  {list.length>0&&<div className="table-wrap capped-table"><table>
   <thead><tr><th>情景</th><th>状态</th><th>基准数据版本</th><th>草稿版本</th><th>操作</th></tr></thead>
   <tbody>{list.map(item=><tr key={item.id}><td>{subject(item)}</td><td>{label[item.status]}</td><td>{item.baseRevision}</td><td>{item.revision}</td><td><button type="button" disabled={busy} onClick={()=>void open(item.id)}>查看草稿</button></td></tr>)}</tbody>
  </table></div>}
  {selected&&<div className="form-panel">
   <h4>{subject(selected)} · {label[selected.status]}</h4>
   {selected.policyVersion&&<p className="compact-note">由自动保存策略第 {selected.policyVersion} 版生成。</p>}
   <p>拟派工 {selected.rows.length} 条，保留现有派工 {selected.stats.retained} 条，冲突 {selected.stats.conflicts} 条。</p>
   {!!selected.deliveries?.length&&<ul>{selected.deliveries.map(batch=><li key={batch.label}>{batch.label} · {batch.quantity} 件 · 承诺 {batch.due} · {batch.finish||'预测窗口内未完'}</li>)}</ul>}
   {!canConfirm&&(selected.status==='draft'||selected.status==='confirmed')&&<p role="status">基准数据已更新，请编辑并重新试算。</p>}
   {(selected.status==='draft'||selected.status==='confirmed')&&<button type="button" disabled={busy} onClick={()=>onEdit(selected)}>编辑草稿</button>}
   {((selected.status==='draft'&&needsReason)||selected.status==='published')&&<label>原因 <textarea maxLength={500} value={reason} onChange={event=>setReason(event.target.value)}/></label>}
   {selected.status==='draft'&&<button className="primary" type="button" disabled={busy||!canConfirm||!selected.rows.length||!!selected.stats.conflicts||(needsReason&&!reason.trim())} onClick={()=>void save('confirm')}>确认草稿</button>}
   {selected.status==='confirmed'&&<button className="primary" type="button" disabled={busy||!canConfirm} onClick={()=>{if(window.confirm('发布这版情景派工？'))void save('publish');}}>人工发布</button>}
   {selected.status==='published'&&<button type="button" disabled={busy||!reason.trim()||revision!==selected.baseRevision+1} onClick={()=>{if(window.confirm('恢复到这次发布之前的计划？'))void save('restore');}}>恢复发布前计划</button>}
   {selected.status==='published'&&revision!==selected.baseRevision+1&&<p role="status">发布后数据已有更新，此版本的整厂恢复已锁定。</p>}
   <details><summary>六日拟派工</summary><div className="table-wrap capped-table"><table><thead><tr><th>日期</th><th>订单</th><th>人员</th><th>设备</th><th>工作量</th>{canAdjust&&<th>操作</th>}</tr></thead>
    <tbody>{selected.rows.map((row,index)=><tr key={index}><td>{row.date}</td><td>{row.orderNo}</td><td>{row.worker}</td><td>{row.machineName||'—'}</td><td>{Number(row.amount.toFixed(3))}</td>
     {canAdjust&&<td><button type="button" disabled={busy} onClick={()=>setMove({rowIndex:index,date:row.date,workerId:workers.find(worker=>worker.name===row.worker)?.id||''})}>调整日期或人员</button></td>}</tr>)}</tbody>
   </table></div></details>
   {move&&canAdjust&&<form className="form-panel" onSubmit={event=>{event.preventDefault();void save('adjust');}}>
    <label>派工日期<input required type="date" value={move.date} onChange={event=>setMove({...move,date:event.target.value})}/></label>
    <label>派工人员<select required value={move.workerId} onChange={event=>setMove({...move,workerId:event.target.value})}><option value="">选择人员</option>
     {workers.filter(worker=>worker.active).map(worker=><option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label>
    <button type="submit" className="primary" disabled={busy}>保存派工调整</button>
    <button type="button" onClick={()=>setMove(null)}>取消调整</button>
   </form>}
   <ul>{selected.events.map(item=><li key={item.kind+item.at}>{item.kind} · {item.actor} · {new Date(item.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}{item.reason?' · '+item.reason:''}</li>)}</ul>
  </div>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
