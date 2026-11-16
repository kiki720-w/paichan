import {useEffect,useRef,useState,type FormEvent} from 'react';
import {outsourcingTotals,type OutsourcingAction} from './outsourcing-progress';
import type {AppState} from './scheduler-app';

type Order=AppState['orders'][number];
type Draft={orderId:string;kind:'send'|'return'|'inspect';batchId?:string};
const format=new Intl.NumberFormat('zh-CN',{maximumFractionDigits:8});
const amount=(quantity:number)=>format.format(quantity);
const time=(at:string)=>new Date(at).toLocaleString('zh-CN');
const titles={send:'登记送出',return:'登记回厂',inspect:'登记验收'};

export function OutsourcingProgressPanel({orders,onSave}:{orders:Order[];onSave:(orderId:string,action:OutsourcingAction)=>Promise<boolean>}){
 const [draft,setDraft]=useState<Draft|null>(null),[quantity,setQuantity]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null);
 const task=draft?orders.find(order=>order.id===draft.orderId):undefined;
 const totals=task?outsourcingTotals(task):undefined;
 const batch=totals?.progress.returned.find(item=>item.id===draft?.batchId);
 const limit=draft?.kind==='send'?totals?.unsent:draft?.kind==='return'?totals?.outstanding:batch?.quantity;
 useEffect(()=>{const element=dialog.current;if(element&&!element.open)element.showModal()},[draft]);

 function open(next:Draft){setQuantity('');setError('');setDraft(next)}
 async function submit(event:FormEvent){
  event.preventDefault();
  if(!draft||saving||quantity==='')return;
  const value=Number(quantity);
  setSaving(true);setError('');
  try{
   const action:OutsourcingAction=draft.kind==='inspect'?{kind:'inspect',batchId:draft.batchId!,passed:value}:{kind:draft.kind,quantity:value};
   if(await onSave(draft.orderId,action))setDraft(null);
   else setError('保存未完成，请关闭窗口并刷新后核对记录。');
  }catch(error){setError(error instanceof Error?error.message:'登记失败，请重试。')}
  finally{setSaving(false)}
 }

 return <section className="panel">
  <div className="panel-title"><h3>外协加工任务</h3></div>
  {!orders.length?<div className="empty">暂无外协任务</div>:<div className="table-wrap"><table className="outsourcing-progress-table">
   <thead><tr><th>订单 / 工件</th><th>交期</th><th>送出 / 回厂</th><th>未回数量</th><th>验收</th><th>操作</th></tr></thead>
   <tbody>{orders.map(order=>{
    const {progress,sent,returned,notReturned,unsent,outstanding,accepted,pending,rejected,complete}=outsourcingTotals(order);
    const hasHistory=progress.previousAccepted>0||progress.sent.length>0||progress.returned.length>0;
    return <tr key={order.id}><td><b className="mono">{order.orderNo}</b><small className="cell-note">{order.partCode} · {order.name}</small>{order.customer&&<small className="cell-note">{order.customer}</small>}</td><td>{order.due||'—'}</td>
     <td><b>{amount(sent)} / {amount(returned)}</b><small className="cell-note">任务数量 {amount(order.qty)}</small></td>
     <td><b>{amount(notReturned)}</b><small className="cell-note">待送 {amount(unsent)} · 已送未回 {amount(outstanding)}</small></td>
     <td><span className={complete?'ok':rejected>0?'late':'pending'}>{complete?'验收完成':rejected>0?'有不合格':'未完成'}</span><small className="cell-note">合格 {amount(accepted)} · 待验 {amount(pending)} · 不合格 {amount(rejected)}</small></td>
     <td><div className="row-actions">{unsent>0&&<button type="button" className="import" onClick={()=>open({orderId:order.id,kind:'send'})}>登记送出</button>}{outstanding>0&&<button type="button" className="import" onClick={()=>open({orderId:order.id,kind:'return'})}>登记回厂</button>}</div>
      {hasHistory&&<details className="outsourcing-history" open={pending>0?true:undefined}>
       <summary>批次与记录</summary>
       {progress.previousAccepted>0&&<div>历史已完成 {amount(progress.previousAccepted)}</div>}
       {progress.sent.map(item=><div key={item.id}>送出 {amount(item.quantity)} · {item.by} · {time(item.at)}</div>)}
       {progress.returned.map((item,index)=><div key={item.id}>第 {index+1} 批回厂 {amount(item.quantity)} · {item.by} · {time(item.at)}
        {item.inspection?<small className="cell-note">验收合格 {amount(item.inspection.passed)} · 不合格 {amount(item.quantity-item.inspection.passed)} · {item.inspection.by} · {time(item.inspection.at)}</small>:<button className="import" type="button" onClick={()=>open({orderId:order.id,kind:'inspect',batchId:item.id})}>验收第 {index+1} 批</button>}
       </div>)}
      </details>}
     </td></tr>;
   })}</tbody>
  </table></div>}
  {task&&draft&&<dialog ref={dialog} className="outsourcing-dialog" aria-labelledby="outsourcing-progress-title" onCancel={event=>{event.preventDefault();if(!saving)setDraft(null)}}>
   <form className="password-dialog" onSubmit={submit}>
    <h3 id="outsourcing-progress-title">{titles[draft.kind]}</h3><p>{task.orderNo} · {task.partCode}</p>
    <label>{draft.kind==='inspect'?'合格数量':'数量'} <input autoFocus type="number" step="any" min="0" max={limit} required value={quantity} disabled={saving} onChange={event=>setQuantity(event.target.value)}/></label>
    <small className="cell-note">{draft.kind==='inspect'?'本批回厂':'最多可登记'} {amount(limit||0)}{draft.kind==='inspect'&&quantity!==''?' · 不合格 '+amount(Math.max(0,(limit||0)-Number(quantity))):''}</small>
    {error&&<p className="login-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button className="import" type="button" disabled={saving} onClick={()=>setDraft(null)}>取消</button><button className="primary" type="submit" disabled={saving}>保存记录</button></div>
   </form>
  </dialog>}
 </section>;
}
