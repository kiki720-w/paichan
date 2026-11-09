import {useState} from 'react';
import {gapKey, previewBatchGaps} from './scheduling-operations';
import type {AppState, ScheduleShortage} from './scheduler-app';

export function MioraGapDialog({state,rows,earliestDate,onClose,onApply}:{
 state:AppState;rows:ScheduleShortage[];earliestDate:string;onClose:()=>void;
 onApply:(preview:ReturnType<typeof previewBatchGaps>)=>Promise<boolean>;
}){
 const [selected,setSelected]=useState<string[]>([]);
 const [startDate,setStartDate]=useState(earliestDate);
 const [preview,setPreview]=useState<ReturnType<typeof previewBatchGaps>|null>(null);
 const [error,setError]=useState(''),[saving,setSaving]=useState(false);
 function clearPreview(){setPreview(null);setError('')}
 function previewSelection(){
  clearPreview();
  if(!startDate||startDate<earliestDate){setError('补排开始日期不能早于今天');return}
  try{setPreview(previewBatchGaps(state,selected,startDate))}
  catch(e){setError(e instanceof Error?e.message:'补排试算失败')}
 }
 async function apply(){
  if(!preview||saving||!preview.items.some(item=>item.added>0))return;
  setSaving(true);
  try{if(!await onApply(preview))setError('未保存；如果计划已被刷新，请重新试算。')}
  finally{setSaving(false)}
 }
 return <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="批量补排产能缺口">
  <form onSubmit={event=>{event.preventDefault();previewSelection()}}>
   <h3>批量补排产能缺口</h3>
   <p>从所选日期起试排六个工作日，只占用剩余正常班产能。现有派工和历史计划不变。</p>
   <label>开始补排日期<input type="date" min={earliestDate} required value={startDate} disabled={saving} onChange={event=>{setStartDate(event.target.value);clearPreview()}}/></label>
   <fieldset className="assignment-mode"><legend>选择要补排的订单</legend>
    <div className="checks">{rows.map(row=>{
     const id=gapKey(row);
     return <label key={id}><input type="checkbox" disabled={saving} checked={selected.includes(id)} onChange={event=>{
      setSelected(event.target.checked?[...selected,id]:selected.filter(key=>key!==id));clearPreview();
     }}/><span>{row.orderNo} · 未排 {row.remainingWork.toFixed(1)}</span></label>;
    })}</div>
   </fieldset>
   {preview&&<div className="table-wrap capped-table"><table><thead><tr><th>订单</th><th>本次补排</th><th>剩余</th><th>说明</th></tr></thead>
    <tbody>{preview.items.map(item=><tr key={item.key}><td>{item.orderNo}</td><td>{item.added.toFixed(1)}</td><td>{item.remaining.toFixed(1)}</td><td>{item.note}</td></tr>)}</tbody>
   </table></div>}
   {error&&<p role="alert" className="miora-error">{error}</p>}
   <div className="dialog-actions">
    <button type="button" className="import" disabled={saving} onClick={onClose}>关闭</button>
    <button type="submit" className="import" disabled={saving||!selected.length}>试算补排</button>
    <button type="button" className="primary" disabled={saving||!preview?.items.some(item=>item.added>0)} onClick={apply}>{saving?'保存中…':'保存补排结果'}</button>
   </div>
  </form>
 </div>;
}
