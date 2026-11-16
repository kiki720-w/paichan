import {useEffect,useState,type FormEvent} from 'react';
import {approvalKinds,approvalStatuses,type ApprovalKind,type ApprovalRequest} from './approval-types';
import type {Factory} from './miora-shell';

type OrderOption={id:string;orderNo:string;partCode:string;remaining:number;due:string};
type Decision={request:ApprovalRequest;status:'approved'|'rejected';note:string};
const emptyForm=()=>({id:crypto.randomUUID(),kind:'urgent' as ApprovalKind,orderId:'',orderNo:'',partCode:'',quantity:'',due:'',reason:''});
const formatTime=(value:string)=>new Date(value).toLocaleString('zh-CN',{hour12:false});

export function ProductionApprovals({factory,role,orders,initialKind}:{
 factory:Factory;role:'main'|'factory';orders:OrderOption[];initialKind:ApprovalKind;
}){
 const [form,setForm]=useState(()=>({...emptyForm(),kind:initialKind}));
 const [requests,setRequests]=useState<ApprovalRequest[]>([]);
 const [filter,setFilter]=useState<ApprovalRequest['status']|'all'>('all');
 const [decision,setDecision]=useState<Decision|null>(null);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [reload,setReload]=useState(0);
 const endpoint=`/api/approvals?factory=${factory}`;
 const selected=orders.find(order=>order.id===form.orderId);

 useEffect(()=>{
  const controller=new AbortController();
  fetch(endpoint,{cache:'no-store',signal:controller.signal}).then(async response=>{
   const result=await response.json();
   if(!response.ok)throw Error(result.message||'读取失败，请重试。');
   if(!controller.signal.aborted)setRequests(result.requests);
  }).catch(problem=>{
   if(!controller.signal.aborted)setError(problem instanceof Error?problem.message:'读取失败，请重试。');
  }).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return ()=>controller.abort();
 },[endpoint,reload]);

 function refresh(){
  setLoading(true);
  setReload(value=>value+1);
 }

 async function send(method:'POST'|'PATCH',body:object){
  setSaving(true);setNotice('');setError('');
  try{
   const response=await fetch(endpoint,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const result=await response.json();
   if(!response.ok){
    if(response.status===409){setDecision(null);refresh()}
    throw Error(result.message||'保存失败，请重试。');
   }
   setNotice(method==='POST'?'申请已提交，等待审批。':'审批结果已保存。');
   refresh();
   return true;
  }catch(problem){
   setError(problem instanceof Error?problem.message:'保存失败，请重试。');
   return false;
  }finally{setSaving(false)}
 }

 async function submit(event:FormEvent){
  event.preventDefault();
  if(saving)return;
  if(await send('POST',{...form,quantity:Number(form.quantity)}))setForm({...emptyForm(),kind:form.kind});
 }

 async function decide(event:FormEvent){
  event.preventDefault();
  if(!decision||saving)return;
  if(await send('PATCH',{id:decision.request.id,status:decision.status,note:decision.note}))setDecision(null);
 }

 const visible=requests.filter(request=>filter==='all'||request.status===filter);
 return <>
  {role==='factory'&&<section className="panel">
   <div className="panel-title"><h3>提交申请</h3></div>
   <form onSubmit={submit} className="form-panel">
    <fieldset disabled={saving} style={{border:0,padding:0,margin:0,display:'grid',gap:10}}>
     <label>申请类型<select value={form.kind} onChange={event=>setForm({...emptyForm(),kind:event.target.value as ApprovalKind})}>
      {Object.entries(approvalKinds).map(([key,label])=><option key={key} value={key}>{label}</option>)}
     </select></label>
     {form.kind==='urgent'?<div className="row">
      <label>订单号<input required maxLength={100} value={form.orderNo} onChange={event=>setForm({...form,orderNo:event.target.value})}/></label>
      <label>物料编码<input required maxLength={100} value={form.partCode} onChange={event=>setForm({...form,partCode:event.target.value})}/></label>
     </div>:<label>本厂内部订单<select required value={form.orderId} onChange={event=>{
      const order=orders.find(item=>item.id===event.target.value);
      setForm({...form,orderId:event.target.value,due:order?.due||'',quantity:''});
     }}>
      <option value="">请选择未完工订单</option>
      {orders.map(order=><option key={order.id} value={order.id}>{order.orderNo} / {order.partCode}（剩余 {order.remaining}）</option>)}
     </select></label>}
     <div className="row">
      <label>申请数量<input required type="number" min="0.000001" step="any" max={selected?.remaining} value={form.quantity} onChange={event=>setForm({...form,quantity:event.target.value})}/></label>
      <label>{form.kind==='urgent'?'要求完成日期':'要求外协完成日期'}<input required type="date" value={form.due} onChange={event=>setForm({...form,due:event.target.value})}/></label>
     </div>
     <label>申请原因<textarea required maxLength={500} rows={3} value={form.reason} onChange={event=>setForm({...form,reason:event.target.value})}/></label>
     <div><button className="primary" type="submit">{saving?'提交中…':'提交申请'}</button></div>
    </fieldset>
   </form>
  </section>}
  <section className="panel" aria-busy={loading}>
   <div className="panel-title">
    <div><h3>本厂审批记录</h3><p className="panel-count">共 {requests.filter(item=>item.status==='pending').length} 条待审批</p></div>
    <div className="miora-actions">
     <select aria-label="筛选审批状态" value={filter} onChange={event=>setFilter(event.target.value as typeof filter)}>
      <option value="all">全部状态</option>
      {Object.entries(approvalStatuses).map(([key,label])=><option key={key} value={key}>{label}</option>)}
     </select>
     <button className="import" type="button" disabled={loading||saving} onClick={()=>{setError('');refresh()}}>刷新记录</button>
    </div>
   </div>
   <p className="rule-help">审批结果供计划员执行。订单、外协任务和派工需在业务页面另行处理。</p>
   {notice&&<p role="status" className="compact-note">{notice}</p>}
   {error&&!decision&&<p role="alert" className="login-error">{error}</p>}
   {visible.length>0?<div className="table-wrap capped-table"><table aria-label="审批记录">
    <thead><tr><th>申请</th><th>数量与日期</th><th>申请人及原因</th><th>结果</th></tr></thead>
    <tbody>{visible.map(item=><tr key={item.id}>
     <td><strong>{approvalKinds[item.kind]}</strong><small className="cell-note">{item.orderNo} / {item.partCode}</small></td>
     <td>{item.quantity}<small className="cell-note">{item.due}</small></td>
     <td className="wrap-cell">{item.submittedBy}<small className="cell-note">{formatTime(item.submittedAt)}</small>{item.reason}</td>
     <td className="wrap-cell">
      <span className={item.status==='pending'?'pending':item.status==='approved'?'ok':'late'}>{approvalStatuses[item.status]}</span>
      {item.status==='pending'&&role==='main'&&<div className="miora-actions">
       <button type="button" className="import" onClick={()=>{setError('');setDecision({request:item,status:'approved',note:''})}}>审批</button>
      </div>}
      {item.decidedAt&&<small className="cell-note">{item.decidedBy} · {formatTime(item.decidedAt)}</small>}
      {item.decisionNote}
     </td>
    </tr>)}</tbody>
   </table></div>:<p className="compact-note">{loading?'正在读取申请…':'当前状态下没有申请记录。'}</p>}
  </section>
  {decision&&<div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="处理审批">
   <form onSubmit={decide}>
    <h3>处理{approvalKinds[decision.request.kind]}申请</h3>
    <p>{decision.request.orderNo} / {decision.request.partCode}</p>
    <label>审批结果<select disabled={saving} value={decision.status} onChange={event=>setDecision({...decision,status:event.target.value as Decision['status']})}>
     <option value="approved">通过</option><option value="rejected">驳回</option>
    </select></label>
    <label>审批意见<textarea required maxLength={500} disabled={saving} rows={3} value={decision.note} onChange={event=>setDecision({...decision,note:event.target.value})}/></label>
    {error&&<p role="alert" className="login-error">{error}</p>}
    <div className="dialog-actions">
     <button type="button" className="import" disabled={saving} onClick={()=>{setDecision(null);setError('')}}>取消</button>
     <button type="submit" className="primary" disabled={saving}>{saving?'保存中…':'确认审批'}</button>
    </div>
   </form>
  </div>}
 </>;
}
