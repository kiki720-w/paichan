import {useState,type FormEvent} from 'react';
import {calendarLabels,validateCalendarEntry,type CalendarEntry} from './production-calendar';

type Worker={id:string;name:string};
type Props={factory:string;entries:CalendarEntry[];workers:Worker[];workingWindows?:string;onEditWindows:()=>void;onSave:(entries:CalendarEntry[])=>Promise<boolean>};
const emptyEntry=():CalendarEntry=>({id:'',kind:'holiday',start:'',end:'',workerIds:[],note:''});

export function ProductionCalendarPanel({factory,entries,workers,workingWindows,onEditWindows,onSave}:Props){
 const [draft,setDraft]=useState<CalendarEntry|null>(null);
 const [error,setError]=useState('');
 const [saving,setSaving]=useState(false);
 const [timed,setTimed]=useState(false);
 const [wholeFactory,setWholeFactory]=useState(false);
 const scoped=draft?.kind==='leave'||(draft?.kind==='downtime'&&!wholeFactory);

 function open(entry=emptyEntry()){
  setDraft({...entry});
  setTimed(Boolean(entry.startTime||entry.endTime));
  setWholeFactory(entry.kind==='downtime'&&entry.workerIds.length===0);
  setError('');
 }

 async function save(next:CalendarEntry[]){
  setSaving(true);
  setError('');
  try{
   const saved=await onSave(next);
   if(saved)setDraft(null);
   else setError('未保存，请核对最新资料后重试。');
  }finally{setSaving(false)}
 }

 async function submit(event:FormEvent){
  event.preventDefault();
  if(!draft||saving)return;
  if(scoped&&!draft.workerIds.length){setError('请至少选择一名受影响人员。');return}
  if(draft.kind==='downtime'&&timed&&(!draft.startTime||!draft.endTime)){setError('请填写停机起止时间。');return}
  const entry={...draft,startTime:timed?draft.startTime:undefined,endTime:timed?draft.endTime:undefined,id:draft.id||crypto.randomUUID(),end:draft.end||draft.start,workerIds:scoped?draft.workerIds:[],note:draft.note.trim()};
  try{validateCalendarEntry(entry,entries,workers.map(worker=>worker.id),workingWindows)}
  catch(problem){setError(problem instanceof Error?problem.message:'请核对日历资料。');return}
  await save([...entries.filter(item=>item.id!==entry.id),entry]);
 }

 return <section className="panel">
  <div className="panel-title">
   <div><small>{factory}</small><h3>生产日历</h3></div>
   <div className="miora-actions"><button className="import" type="button" onClick={onEditWindows} disabled={saving||!!draft}>设置工作时段</button><button className="import" type="button" disabled={saving||!!draft} onClick={()=>open()}>新增日历记录</button></div>
  </div>
  <p className="rule-help">默认周一至周六生产、周日休息。当前工作时段为 {workingWindows||'尚未设置'}。半天请假和按小时停机按班内分钟扣减，已排任务的冲突可在排产结果查看。</p>
  {entries.length>0?<div className="table-wrap capped-table">
   <table aria-label="生产日历"><thead><tr><th>日期</th><th>类型</th><th>影响范围</th><th>说明</th><th>操作</th></tr></thead><tbody>
    {[...entries].sort((a,b)=>a.start.localeCompare(b.start)).map(entry=><tr key={entry.id}>
     <td>{entry.start}{entry.end!==entry.start&&` 至 ${entry.end}`}</td>
     <td>{calendarLabels[entry.kind]}{(entry.half||entry.startTime)&&<small className="cell-note">{entry.half==='first'?'前半班':entry.half==='second'?'后半班':entry.startTime+'–'+entry.endTime}</small>}</td>
     <td>{entry.workerIds.length?entry.workerIds.map(id=>workers.find(worker=>worker.id===id)?.name||'已移除人员').join('、'):'全厂'}</td>
     <td>{entry.note||'—'}</td>
     <td><div className="miora-actions">
      <button className="import" type="button" disabled={saving||!!draft} onClick={()=>open(entry)}>修改</button>
      <button className="import miora-danger" type="button" disabled={saving||!!draft} onClick={()=>{
       if(window.confirm('删除这条生产日历记录？'))void save(entries.filter(item=>item.id!==entry.id));
      }}>删除</button>
     </div></td>
    </tr>)}
   </tbody></table>
  </div>:<p className="compact-note">尚未登记日历例外。</p>}
  {draft&&<div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label={draft.id?'修改生产日历':'新增生产日历'}>
   <form onSubmit={submit}>
    <h3>{draft.id?'修改生产日历':'新增生产日历'}</h3>
    <label>类型<select value={draft.kind} onChange={event=>{
     setDraft({...draft,kind:event.target.value as CalendarEntry['kind'],workerIds:[],half:undefined,startTime:undefined,endTime:undefined});setWholeFactory(false);setTimed(false);
    }}>{Object.entries(calendarLabels).map(([kind,label])=><option key={kind} value={kind}>{label}</option>)}</select></label>
    <div className="row">
     <label>开始日期<input type="date" required value={draft.start} onChange={event=>setDraft({...draft,start:event.target.value})}/></label>
     <label>结束日期（单日可留空）<input type="date" min={draft.start} value={draft.end} onChange={event=>setDraft({...draft,end:event.target.value})}/></label>
    </div>
    {draft.kind==='leave'&&<label>请假时段<select value={draft.half||''} onChange={event=>setDraft({...draft,half:(event.target.value||undefined) as CalendarEntry['half']})}>
     <option value="">全天</option><option value="first">前半班</option><option value="second">后半班</option>
    </select></label>}
    {draft.kind==='downtime'&&<label>停机时段<select value={timed?'timed':'all'} onChange={event=>setTimed(event.target.value==='timed')}>
     <option value="all">全天</option><option value="timed">按小时</option>
    </select></label>}
    {draft.kind==='downtime'&&timed&&<div className="row">
     <label>停机开始<input type="time" required value={draft.startTime||''} onChange={event=>setDraft({...draft,startTime:event.target.value})}/></label>
     <label>停机结束<input type="time" required value={draft.endTime||''} onChange={event=>setDraft({...draft,endTime:event.target.value})}/></label>
    </div>}
    {draft.kind==='downtime'&&<label><input type="checkbox" checked={wholeFactory} onChange={event=>setWholeFactory(event.target.checked)}/> 整厂停机</label>}
    {scoped&&<label>{draft.kind==='leave'?'请假人员':'受影响人员'}<select multiple size={Math.min(6,Math.max(2,workers.length))} value={draft.workerIds} onChange={event=>setDraft({...draft,workerIds:Array.from(event.target.selectedOptions,option=>option.value)})}>
     {workers.map(worker=><option key={worker.id} value={worker.id}>{worker.name}</option>)}
    </select><small>按住 Ctrl 或 Command 可多选。</small></label>}
    <label>{draft.kind==='downtime'?'设备名称或停机范围':'说明（可选）'}<input required={draft.kind==='downtime'} maxLength={120} value={draft.note} onChange={event=>setDraft({...draft,note:event.target.value})}/></label>
    {error&&<p role="alert" className="login-error">{error}</p>}
    <div className="dialog-actions">
     <button className="import" type="button" disabled={saving} onClick={()=>{setDraft(null);setError('')}}>取消</button>
     <button className="primary" type="submit" disabled={saving}>{saving?'保存中…':'保存日历'}</button>
    </div>
   </form>
  </div>}
  {!draft&&error&&<p role="alert" className="login-error">{error}</p>}
 </section>;
}
