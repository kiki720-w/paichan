import {useState,type FormEvent} from 'react';
import {earlierTasks,inspectProcess,processRelease,setProcessPredecessor,type ProcessTask} from './process-quality';

type Props={tasks:ProcessTask[];actor:string;onSave:(tasks:ProcessTask[],summary:string)=>Promise<boolean>};

export function ProcessQuality({tasks,actor,onSave}:Props){
 const [draft,setDraft]=useState<{id:string;mode:'route'|'quality';predecessor:string;passed:string;failed:string}|null>(null);
 const [error,setError]=useState('');
 const [saving,setSaving]=useState(false);
 const [query,setQuery]=useState('');
 const task=tasks.find(item=>item.id===draft?.id);
 const visible=tasks.filter(item=>[item.workOrderNo,item.partCode,item.operationName,item.operationNo].some(value=>value.toLowerCase().includes(query.trim().toLowerCase())));
 function open(item:ProcessTask,mode:'route'|'quality'){
  setDraft({id:item.id,mode,predecessor:item.predecessorId===null?'first':item.predecessorId||'',
   passed:String(item.inspection?.passed??''),failed:String(item.inspection?.failed??'')});
  setError('');
 }
 async function save(event:FormEvent){
  event.preventDefault();
  if(!draft||!task||saving)return;
  setSaving(true);
  setError('');
  try{
   let next:ProcessTask[],summary:string;
   if(draft.mode==='route'){
    if(!draft.predecessor)throw Error('请选择前序工序或确认本工序为首道。');
    next=setProcessPredecessor(task,tasks,draft.predecessor==='first'?null:draft.predecessor);
    summary=`${task.workOrderNo} 工序 ${task.operationNo} 更新前序关系`;
   }else{
    if(draft.passed.trim()===''||draft.failed.trim()==='')throw Error('请分别填写累计合格和不合格数量，零件数可填 0。');
    next=inspectProcess(task,tasks,Number(draft.passed),Number(draft.failed),actor,new Date().toISOString());
    summary=`${task.workOrderNo} 工序 ${task.operationNo} 质检：合格 ${draft.passed}，不合格 ${draft.failed}`;
   }
   if(await onSave(next,summary))setDraft(null);else setError('未保存，请核对最新数据后重试。');
  }catch(problem){setError(problem instanceof Error?problem.message:'保存失败，请重试。')}
  finally{setSaving(false)}
 }

 return <section className="panel">
  <div className="panel-title"><div><h3>工序任务与质检</h3><small>前序合格数量决定下一工序可加工数量</small></div></div>
  {tasks.length>0?<><input type="search" aria-label="查找工序" placeholder="搜索工单、物料或工序" value={query} onChange={event=>setQuery(event.target.value)}/>
   <div className="table-wrap capped-table"><table aria-label="工序与质检">
    <thead><tr><th>工单 / 物料</th><th>工序与前序</th><th>计划 / 已完工</th><th>已放行 / 待放行</th><th>累计质检</th><th>操作</th></tr></thead>
    <tbody>{visible.map(item=>{
     const released=processRelease(item,tasks);
     const predecessor=tasks.find(candidate=>candidate.id===item.predecessorId);
     return <tr key={item.id}>
      <td><b>{item.workOrderNo}</b><small className="cell-note">{item.partCode} · {item.partName}</small><small className="cell-note">{item.planNo||'—'} / {item.drawingNo||'无图号'}</small></td>
      <td>{item.operationNo} · {item.operationName}<small className="cell-note">{item.predecessorId===null?'首道工序':predecessor?`前序 ${predecessor.operationNo} · ${predecessor.operationName}`:'待确认前序'}</small></td>
      <td>{item.plannedQty} / {item.completedQty}<small className="cell-note">要求完成 {item.due||'—'}</small><small className="cell-note">{item.lastReportAt||'未报工'} {item.producers?.join('、')}</small></td>
      <td>{released} / {Math.max(0,item.plannedQty-released)}
       {item.completedQty>released&&<small className="cell-note late">已完工数超出放行数，请核对</small>}</td>
      <td>{item.inspection?<><span>合格 {item.inspection.passed} ／ 不合格 {item.inspection.failed}</span>
       <small className="cell-note">{item.inspection.by} · {new Date(item.inspection.at).toLocaleString('zh-CN')}</small></>:'待质检'}</td>
      <td><div className="row-actions">
       <button className="import" type="button" onClick={()=>open(item,'route')}>设置前序</button>
       <button className="import" type="button" onClick={()=>open(item,'quality')}>{item.inspection?'更正质检':'录入质检'}</button>
      </div></td>
     </tr>;
    })}</tbody>
   </table></div>
   {!visible.length&&<p className="compact-note">未找到匹配的工序。</p>}</>:<div className="empty"><b>暂无工序任务</b><span>在数据导入中导入生产进度报表。</span></div>}
  {draft&&task&&<div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label={draft.mode==='route'?'设置前序':'录入质检'}>
   <form onSubmit={save}>
    <h3>{draft.mode==='route'?'设置前序工序':'录入累计质检结果'}</h3>
    <p>{task.workOrderNo} / {task.operationNo} · {task.operationName}</p>
    {draft.mode==='route'?<label>前序工序<select required disabled={saving} value={draft.predecessor} onChange={event=>setDraft({...draft,predecessor:event.target.value})}>
     <option value="">请选择</option><option value="first">首道工序</option>
     {earlierTasks(task,tasks).map(item=><option value={item.id} key={item.id}>{item.operationNo} · {item.operationName}</option>)}
    </select></label>:<>
     <p>当前最多可检验 {Math.max(0,Math.min(task.completedQty,processRelease(task,tasks)))} 件。请填写累计结果。</p>
     <div className="row">
      <label>合格数量<input type="number" min="0" step="any" required disabled={saving} value={draft.passed} onChange={event=>setDraft({...draft,passed:event.target.value})}/></label>
      <label>不合格数量<input type="number" min="0" step="any" required disabled={saving} value={draft.failed} onChange={event=>setDraft({...draft,failed:event.target.value})}/></label>
     </div>
    </>}
    {error&&<p role="alert" className="login-error">{error}</p>}
    <div className="dialog-actions"><button className="import" type="button" disabled={saving} onClick={()=>setDraft(null)}>取消</button><button className="primary" disabled={saving} type="submit">保存</button></div>
   </form>
  </div>}
 </section>;
}
