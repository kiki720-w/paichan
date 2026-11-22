import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {AppState} from './scheduler-app';
import type {SchedulingScenario,SchedulingScenarioResult} from './scheduling-scenarios';
import {ScenarioDraftsPanel} from './scenario-drafts-panel';
import {ScenarioIntakePanel} from './scenario-intake-panel';
import type {ScenarioDraft} from './scenario-drafts';
import type {DeliveryBatch} from './delivery-batches';

const qty=(value:number)=>Number(value.toFixed(2)).toLocaleString('zh-CN');
const complete=(value:string|null,notReady=false)=>value||(notReady?'资料待补':'30 工作日内未完');
const emptyBatches=(due=''):DeliveryBatch[]=>[{label:'第一批',quantity:0,due},{label:'第二批',quantity:0,due}];

export function SchedulingScenarioPanel({state,factory,revision,day,initialOrderId,onPlanChange}:{
 state:AppState;factory:string;revision:number;day:string;initialOrderId?:string;onPlanChange:()=>Promise<unknown>;
}){
 const [kind,setKind]=useState<SchedulingScenario['kind']>(initialOrderId?'due':'insert');
 const [orderNo,setOrderNo]=useState(''),[partCode,setPartCode]=useState(''),[quantity,setQuantity]=useState('');
 const [workerId,setWorkerId]=useState(''),[orderId,setOrderId]=useState(initialOrderId||'');
 const [start,setStart]=useState(day),[end,setEnd]=useState(day),[due,setDue]=useState(()=>state.orders.find(order=>order.id===initialOrderId)?.due||'');
 const [batches,setBatches]=useState<DeliveryBatch[]>(()=>emptyBatches());
 const [view,setView]=useState<SchedulingScenarioResult|null>(null),[error,setError]=useState('');
 const [editing,setEditing]=useState<ScenarioDraft|null>(null);
 const [calculating,setCalculating]=useState(false),request=useRef<AbortController|null>(null);
 useEffect(()=>()=>request.current?.abort(),[]);
 const selected=state.orders.find(item=>item.id===orderId);
 const [activePlan,setActivePlan]=useState(1);
 const old=view?.revision!==revision||view?.start!==day;
 const candidate=view?.overtime||view?.alternate;
 const candidateLabel=view?.overtime?'情景含加班':'平衡人员负荷';
 const plans:[string,SchedulingScenarioResult['normal']][]=view?[
  ['基准正常班',view.baseline],['情景正常班',view.normal],...(candidate?[[candidateLabel,candidate] as [string,SchedulingScenarioResult['normal']]]:[]),
 ]:[];
 function stopPreview(){
  request.current?.abort();request.current=null;setCalculating(false);
 }
 async function preview(event:FormEvent){
  event.preventDefault();setView(null);setError('');setActivePlan(1);
  let scenario:SchedulingScenario;
  if(kind==='leave')scenario={kind,workerId,start,end};
  else if(kind==='due')scenario={kind,orderId,due};
  else if(kind==='split')scenario={kind,orderId,batches};
  else scenario={kind,orderNo,partCode,quantity:Number(quantity),due};
  request.current?.abort();
  const controller=new AbortController();request.current=controller;setCalculating(true);
  const deadline=setTimeout(()=>{
   if(request.current!==controller)return;
   stopPreview();setError('试算等待已超过 30 秒，请重试。');
  },30000);
  try{
   const response=await fetch('/api/scenario-drafts?factory='+factory,{method:'POST',
    signal:controller.signal,headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'preview',baseRevision:revision,day,input:scenario}),
   });
   const result=await response.json();
   if(!response.ok)throw Error(result.message||'情景试算失败，请核对表单。');
   if(!controller.signal.aborted)setView(result.preview);
  }catch(issue){if(!controller.signal.aborted)setError(issue instanceof Error?issue.message:'情景试算失败，请核对表单。');}
  finally{
   clearTimeout(deadline);
   if(request.current===controller){request.current=null;setCalculating(false);}
  }
 }
 function setScenario(input:SchedulingScenario){
  stopPreview();setView(null);setError('');setKind(input.kind);
  if(input.kind==='insert'){setOrderNo(input.orderNo);setPartCode(input.partCode);setQuantity(String(input.quantity));setDue(input.due);}
  if(input.kind==='leave'){setWorkerId(input.workerId);setStart(input.start);setEnd(input.end);}
  if(input.kind==='due'){setOrderId(input.orderId);setDue(input.due);}
  if(input.kind==='split'){setOrderId(input.orderId);setBatches(input.batches);}
 }
 function edit(draft:ScenarioDraft|null){
  setEditing(draft);
  if(draft)setScenario(draft.input);
 }
 function selectOrder(id:string){
  const order=state.orders.find(item=>item.id===id);
  setOrderId(id);setDue(order?.due||'');
  setBatches(order?.deliveryBatches||emptyBatches(order?.due));
 }
 function setBatch(index:number,values:Partial<DeliveryBatch>){
  setBatches(current=>current.map((batch,position)=>position===index?{...batch,...values}:batch));
 }
 return <div className="compact-page">
  <section className="panel"><div className="panel-title"><div><h3>情景试算</h3><small>对比六日派工和三十工作日预测</small></div></div>
   <form className="form-panel" onSubmit={preview} onChange={()=>{stopPreview();setView(null);setError('');}}>
    <label>情景<select aria-label="情景" value={kind} onChange={event=>setKind(event.target.value as SchedulingScenario['kind'])}><option value="insert">紧急插单</option><option value="leave">人员请假</option><option value="due">调整交期</option><option value="split">分批交付</option></select></label>
    {kind==='insert'&&<><label>试算工单号<input required value={orderNo} onChange={event=>setOrderNo(event.target.value)}/></label><div className="row"><label>工件<select required value={partCode} onChange={event=>setPartCode(event.target.value)}><option value="">选择工件</option>{state.parts.filter(part=>part.processMode!=='external').map(part=><option key={part.code} value={part.code}>{part.code} · {part.name}</option>)}</select></label><label>数量<input required type="number" min="0.001" step="any" value={quantity} onChange={event=>setQuantity(event.target.value)}/></label></div></>}
    {(kind==='due'||kind==='split')&&<label>待加工订单<select aria-label="待加工订单" required value={orderId} onChange={event=>selectOrder(event.target.value)}><option value="">选择订单</option>{state.orders.filter(order=>order.done<order.qty&&order.status!=='已完成').map(order=><option key={order.id} value={order.id}>{order.orderNo} · {order.partCode}{order.mesOperationNo?` · 工序 ${order.mesOperationNo}`:''}</option>)}</select>{selected&&<small>原交期 {selected.due||'待补充'} · 剩余 {qty(selected.qty-selected.done)} 件</small>}</label>}
    {kind==='leave'&&<><label>请假人员<select required value={workerId} onChange={event=>setWorkerId(event.target.value)}><option value="">选择人员</option>{state.workers.filter(worker=>worker.active).map(worker=><option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label><div className="row"><label>开始日期<input required type="date" value={start} onChange={event=>setStart(event.target.value)}/></label><label>结束日期<input required type="date" value={end} onChange={event=>setEnd(event.target.value)}/></label></div></>}
    {(kind==='insert'||kind==='due')&&<label>试算交期<input required type="date" value={due} onChange={event=>setDue(event.target.value)}/></label>}
    {kind==='split'&&<div className="form-panel">{batches.map((batch,index)=><div className="row" key={index}>
     <label>批次号<input required maxLength={50} value={batch.label} onChange={event=>setBatch(index,{label:event.target.value})}/></label>
     <label>数量<input required type="number" min="0.001" step="any" value={batch.quantity||''} onChange={event=>setBatch(index,{quantity:Number(event.target.value)})}/></label>
     <label>承诺日期<input required type="date" value={batch.due} onChange={event=>setBatch(index,{due:event.target.value})}/></label>
     {batches.length>2&&<button type="button" onClick={()=>{setView(null);setBatches(items=>items.filter((_,i)=>i!==index));}}>移除批次</button>}
    </div>)}{batches.length<30&&<button type="button" onClick={()=>{setView(null);setBatches(items=>[...items,{label:'',quantity:0,due:''}]);}}>添加批次</button>}</div>}
    <button type="submit" className="primary" disabled={calculating}>生成对比</button>
    {calculating&&<div role="status">正在试算 <button type="button" onClick={stopPreview}>取消试算</button></div>}
    {error&&<p className="miora-error" role="alert">{error}</p>}
   </form>
  </section>
  <ScenarioIntakePanel state={state} factory={factory} onApply={setScenario}/>
  {view&&<section className="panel" aria-label="情景试算对比"><div className="panel-title"><h3>试算对比</h3><small>基准版本 {view.revision} · {view.start}</small></div>
   {old&&<p role="status" className="import-issues">基准数据已更新，请重新试算。</p>}
   <p className="compact-note">保留 {view.retained.length} 条原派工。当前结果为独立试算。</p>
   <div className="table-wrap"><table><thead><tr><th>方案</th><th>六日拟派工</th><th>六日缺口工作量</th><th>预计延期或未完成</th><th>三十工作日内未完</th><th>加班工作量</th><th>待补资料</th></tr></thead>
    <tbody>{plans.map(([label,data])=><tr key={label}><td>{label}</td><td>{data.sixDays.length}</td><td>{qty(data.sixDayGap)}</td><td>{data.late}</td><td>{data.unfinished}</td><td>{qty(data.overtimeWork)}</td><td>{data.blocked.length}</td></tr>)}</tbody>
   </table></div>
   {!candidate&&<p className="compact-note">当前人员、设备和产能条件下，试算仅找到一种安排。</p>}
   {view.deliveries.length>0&&<div className="table-wrap capped-table"><table><caption>分批交付预测</caption>
    <thead><tr><th>批次号</th><th>承诺日期</th><th>数量</th><th>预测已安排</th><th>预计完工</th>{candidate&&<th>候选方案预计完工</th>}</tr></thead>
    <tbody>{view.deliveries.map((batch,index)=><tr key={batch.label}><td>{batch.label}</td><td>{batch.due}</td><td>{qty(batch.quantity)}</td><td>{qty(batch.scheduled)}</td><td>{complete(batch.finish)}</td>{candidate&&<td>{complete(view.otherDeliveries[index]?.finish||null)}</td>}</tr>)}</tbody>
   </table></div>}
   {view.conflicts.length>0&&<details open><summary>请假与 {view.conflicts.length} 条已确认或已发布派工冲突</summary><ul>{view.conflicts.map((row,index)=><li key={index}>{row.date} · {row.worker} · {row.orderNo}</li>)}</ul></details>}
   {view.comparison.length>0&&<details open><summary>受影响订单 {view.comparison.length} 项</summary><div className="table-wrap capped-table"><table><thead><tr><th>订单 / 物料</th><th>交期变化</th><th>基准完工</th><th>情景完工</th><th>人员变化</th>{candidate&&<><th>候选完工</th><th>候选人员</th></>}</tr></thead><tbody>{view.comparison.map(item=><tr key={item.id}><td>{item.orderNo} · {item.partCode}</td><td>{item.beforeDue||'新增'} → {item.due||'待补充'}</td><td>{item.beforeDue?complete(item.beforeFinish):'—'}</td><td>{complete(item.finish,item.notReady)}</td><td>{item.beforeWorkers.join('、')||'—'} → {item.workers.join('、')||'—'}</td>{candidate&&<><td>{complete(item.otherFinish,item.notReady)}</td><td>{item.otherWorkers.join('、')||'—'}</td></>}</tr>)}</tbody></table></div></details>}
   <details><summary>六日派工和人员负荷明细</summary>
    <label>查看方案 <select value={activePlan} onChange={event=>setActivePlan(Number(event.target.value))}>{plans.map(([label],index)=><option key={label} value={index}>{label}</option>)}</select></label>
    <div className="table-wrap capped-table"><table><caption>拟派工</caption><thead><tr><th>日期</th><th>订单 / 物料</th><th>人员</th><th>设备</th><th>工作量</th><th>安排依据</th></tr></thead>
     <tbody>{plans[activePlan]?.[1].sixDays.map((row,index)=><tr key={index}><td>{row.date}</td><td>{row.orderNo} · {row.partCode}</td><td>{row.worker}</td><td>{row.machineName||'—'}</td><td>{qty(row.amount)}</td><td>{row.reason}</td></tr>)}</tbody>
    </table></div>
    <div className="table-wrap capped-table"><table><caption>人员负荷</caption><thead><tr><th>日期</th><th>人员</th><th>保留工作量</th><th>拟新增工作量</th></tr></thead>
     <tbody>{plans[activePlan]?.[1].loads.map(row=><tr key={JSON.stringify([row.date,row.worker])}><td>{row.date}</td><td>{row.worker}</td><td>{qty(row.locked)}</td><td>{qty(row.planned)}</td></tr>)}</tbody>
    </table></div>
   </details>
   {!!view.normal.blocked.length&&<details><summary>未进入试算的订单 {view.normal.blocked.length} 项</summary><ul>{view.normal.blocked.map(item=><li key={item.key}>{item.orderNo} · {item.partCode} · {item.reason}</li>)}</ul></details>}
  </section>}
  <ScenarioDraftsPanel factory={factory} revision={revision} day={day} view={view} editing={editing} onEdit={edit} onPlanChange={onPlanChange} workers={state.workers}/>
 </div>;
}
