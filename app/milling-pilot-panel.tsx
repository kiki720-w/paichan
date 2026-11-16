import {useState,type FormEvent} from 'react';
import {isMillingTask,type MillingRule} from './milling-pilot';
import type {AppState} from './scheduler-app';

const blank={partCode:'',workerId:'',machineId:'',unit:''};
const format=new Intl.NumberFormat('zh-CN',{maximumFractionDigits:4});

export function MillingPilotPanel({state,revision,today,onRule,onGenerate,onConfirm,onPublish}:{
 state:AppState;revision:number;today:string;onRule:(rule:MillingRule)=>Promise<boolean>;onGenerate:()=>Promise<boolean>;onConfirm:()=>Promise<boolean>;onPublish:()=>Promise<boolean>;
}){
 const [draft,setDraft]=useState(blank),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const tasks=(state.processTasks||[]).filter(isMillingTask);
 const materials=[...new Map(tasks.map(task=>[task.partCode,task.partName])).entries()].filter(([code])=>code);
 const rules=state.millingRules||[],plan=state.millingPlan;
 const workers=state.workers.filter(worker=>worker.active&&worker.capacity>0);
 const machines=(state.machines||[]).filter(machine=>machine.active&&machine.capacity>0);
 function edit(partCode:string){
  const rule=rules.find(item=>item.partCode===partCode);
  setDraft(rule?{...rule,unit:String(rule.unit)}:{...blank,partCode});
 }
 async function save(work:()=>Promise<boolean>){
  if(busy)return;
  setBusy(true);setError('');
  try{if(!await work())setError('未能保存，请刷新数据后重试。')}
  catch(error){setError(error instanceof Error?error.message:'保存失败，请重试。')}
  finally{setBusy(false)}
 }
 function saveRule(event:FormEvent){event.preventDefault();void save(()=>onRule({...draft,unit:Number(draft.unit)}))}

 return <section className="panel" aria-labelledby="milling-pilot-title">
  <div className="panel-title"><div><h3 id="milling-pilot-title">铣工排产试点</h3><small>六个工作日 · 试排草稿</small></div><button type="button" className="primary" disabled={busy||!tasks.length} onClick={()=>void save(onGenerate)}>生成铣工试排</button></div>
  <p className="compact-note">试排避开已有派工，仅安排前序质检放行且尚未加工的整件。更新规则或质检后，可手动生成新的草稿。</p>
  {materials.length? <form className="form-panel" onSubmit={saveRule}>
   <h3>铣工规则</h3>
   <label>铣工物料<select required value={draft.partCode} onChange={event=>edit(event.target.value)}><option value="">选择物料</option>{materials.map(([code,name])=><option key={code} value={code}>{code} · {name}{rules.some(rule=>rule.partCode===code)?'（已配置）':''}</option>)}</select></label>
   <div className="row">
    <label>铣工人员<select required value={draft.workerId} onChange={event=>setDraft({...draft,workerId:event.target.value})}><option value="">选择人员</option>{workers.map(worker=><option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label>
    <label>铣工设备<select required value={draft.machineId} onChange={event=>setDraft({...draft,machineId:event.target.value})}><option value="">选择设备</option>{machines.map(machine=><option key={machine.id} value={machine.id}>{machine.name}</option>)}</select></label>
   </div>
   <label>铣工单件定额<input required type="number" min="0.001" step="any" value={draft.unit} onChange={event=>setDraft({...draft,unit:event.target.value})}/></label>
   <small>单件定额使用与人员、设备日产能相同的标准工作量单位。</small>
   <button type="submit" className="import" disabled={busy}>保存铣工规则</button>
  </form>:<p className="empty">导入工序名称为「铣工」的生产进度后可配置试排。</p>}
  {error&&<p role="alert" className="login-error">{error}</p>}
  {plan&&<>
   <div className="row"><span className={plan.publishedAt?'ok':'pending'}>{plan.publishedAt?'已发布':plan.confirmedAt?'已确认':'草稿'}</span><small>起排日期 {plan.date} · {plan.rows.length} 条安排</small>
    {plan.rows.length>0&&!plan.publishedAt&&<button type="button" className="primary" disabled={busy} onClick={()=>void save(plan.confirmedAt?onPublish:onConfirm)}>{plan.confirmedAt?'发布铣工派工':'确认铣工草稿'}</button>}
   </div>
   {!plan.publishedAt&&(plan.revision!==revision||plan.date!==today)&&<p className="import-issues" role="status">排产依据或日期已更新，确认或发布时会重新核对。</p>}
   {plan.rows.length>0&&<div className="table-wrap capped-table"><table aria-label="铣工试排草稿"><thead><tr><th>日期 / 时段</th><th>工单 / 物料</th><th>人员 / 设备</th><th>数量</th><th>工作量</th></tr></thead><tbody>{plan.rows.map(row=><tr key={`${row.taskId}-${row.date}-${row.startTime}`}><td>{row.date} · {row.startTime}–{row.endTime}</td><td>{row.workOrderNo} · {row.partCode}</td><td>{row.worker} · {row.machineName}</td><td>{row.quantity}</td><td>{format.format(row.amount)}</td></tr>)}</tbody></table></div>}
   {plan.gaps.length>0&&<div className="table-wrap capped-table"><table aria-label="铣工未排原因"><thead><tr><th>工单 / 物料</th><th>未排数量</th><th>原因</th></tr></thead><tbody>{plan.gaps.map(gap=><tr key={`${gap.taskId}-${gap.reason}`}><td>{gap.workOrderNo} · {gap.partCode}</td><td>{format.format(gap.quantity)}</td><td>{gap.reason}</td></tr>)}</tbody></table></div>}
  </>}
 </section>;
}
