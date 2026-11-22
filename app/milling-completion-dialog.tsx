import {useEffect,useRef,useState,type FormEvent} from 'react';
import {millingBatches,millingDispatchKey,type MillingCompletion} from './milling-completion';
import type {Allocation} from './scheduler-app';
import type {ProcessTask} from './process-quality';

export function MillingCompletionDialog({row,task,onClose,onSave}:{
 row:Allocation;task?:ProcessTask;onClose:()=>void;onSave:(input:MillingCompletion)=>Promise<boolean>;
}){
 const [batchId,setBatchId]=useState(''),[quantity,setQuantity]=useState(''),[reason,setReason]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),key=millingDispatchKey(row);
 useEffect(()=>{const element=dialog.current;if(element&&!element.open)element.showModal()},[]);
 const batches=millingBatches(task,key);
 const total=batches.reduce((sum,batch)=>sum+batch.quantity,0);
 const current=batches.find(batch=>batch.batchId===batchId);
 const max=(row.quantity||0)-total+(current?.quantity||0);
 async function submit(event:FormEvent){
  event.preventDefault();
  if(saving||quantity==='')return;
  setSaving(true);setError('');
  try{
   if(await onSave({dispatchKey:key,quantity:Number(quantity),batchId:batchId||undefined,reason}))onClose();
   else setError('保存未完成，请核对最新数据后重试。');
  }catch(problem){setError(problem instanceof Error?problem.message:'保存失败，请重试。')}
  finally{setSaving(false)}
 }
 return <dialog className="outsourcing-dialog" ref={dialog} aria-labelledby="milling-completion-title" onCancel={event=>{event.preventDefault();if(!saving)onClose()}}>
  <form className="password-dialog" onSubmit={submit}>
   <h3 id="milling-completion-title">铣工完工登记</h3>
   <p>{row.orderNo} · {row.partCode} · {row.date} {row.startTime}–{row.endTime}</p>
   <p>已登记 {total} / {row.quantity} 件</p>
   <label>完工批次<select value={batchId} onChange={event=>{const id=event.target.value;setBatchId(id);setQuantity(id?String(batches.find(batch=>batch.batchId===id)?.quantity??''):'');setReason('');setError('')}} disabled={saving}>
    <option value="">登记新批次</option>{batches.map((batch,index)=><option key={batch.batchId} value={batch.batchId}>更正第 {index+1} 批 · {batch.quantity} 件</option>)}
   </select></label>
   <label>{current?'更正后本批数量':'本批完工数量'}<input autoFocus type="number" min={current?0:1} max={max} step="1" required value={quantity} disabled={saving} onChange={event=>setQuantity(event.target.value)}/></label>
   {current&&<label>更正原因<input required value={reason} disabled={saving} onChange={event=>setReason(event.target.value)}/></label>}
   {!!batches.length&&<details><summary>批次记录</summary><ul>{task?.millingReports?.filter(report=>report.dispatchKey===key).map((report,index)=><li key={index}>{report.previous===undefined?'登记 ':`${report.previous} → `}{report.quantity} 件 · {report.by} · {new Date(report.at).toLocaleString('zh-CN')}{report.reason?' · '+report.reason:''}</li>)}</ul></details>}
   {error&&<p className="login-error" role="alert">{error}</p>}
   <div className="dialog-actions"><button type="button" className="import" disabled={saving} onClick={onClose}>取消</button><button type="submit" className="primary" disabled={saving||(!current&&max<1)}>保存完工</button></div>
  </form>
 </dialog>;
}
