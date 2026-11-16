import {useState,type FormEvent} from 'react';
import type {Machine} from './equipment-capacity';
import {clockMinutes,validCalendarDate} from './production-calendar';

type Part={code:string;name:string};
type Props={machines:Machine[];parts:Part[];windows?:string;onSave:(machines:Machine[])=>Promise<boolean>};
const blank=():Machine=>({id:'',name:'',capacity:0,active:true,partCodes:[],stops:[]});

export function EquipmentPanel({machines,parts,windows,onSave}:Props){
 const [draft,setDraft]=useState<Machine|null>(null);
 const [stop,setStop]=useState({date:'',start:'',end:''});
 const [error,setError]=useState('');
 const [saving,setSaving]=useState(false);
 const [query,setQuery]=useState('');
 const open=(machine=blank())=>{setDraft(machine);setStop({date:'',start:'',end:''});setError('');setQuery('')};
 function addStop(){
  if(!draft)return;
  try{
   if(!validCalendarDate(stop.date)||clockMinutes(stop.end,true)<=clockMinutes(stop.start))throw Error('请填写有效的停机日期和起止时间，跨午夜请分开登记。');
   setDraft({...draft,stops:[...draft.stops,stop]});
   setStop({date:'',start:'',end:''});setError('');
  }catch{setError('请填写有效的停机日期和起止时间，跨午夜请分开登记。')}
 }
 async function save(event:FormEvent){
  event.preventDefault();
  if(!draft||saving)return;
  const name=draft.name.trim();
  if(stop.date||stop.start||stop.end){setError('请先添加已填写的停机时段，再保存设备。');return}
  if(!name||!Number.isFinite(draft.capacity)||draft.capacity<=0||!draft.partCodes.length){
   setError('请填写设备名称、正数日产能及适用工件。');return;
  }
  if(machines.some(machine=>machine.id!==draft.id&&machine.name===name)){setError('该设备名称已存在，请修改原设备。');return}
  if(!windows){setError('请先在生产日历中设置工作时段。');return}
  setSaving(true);setError('');
  try{
   const machine={...draft,name,id:draft.id||crypto.randomUUID()};
   if(await onSave([...machines.filter(item=>item.id!==draft.id),machine]))setDraft(null);
   else setError('未保存，请核对最新数据后重试。');
  }finally{setSaving(false)}
 }
 return <section className="panel">
  <div className="panel-title"><h3>设备产能</h3><button className="import" type="button" onClick={()=>open()}>新增设备</button></div>
  <p className="rule-help">为工件选择适用设备，按人员和设备共同空闲的时段排产。设备日产能使用与人员产能相同的工作量单位。</p>
  {machines.length>0?<div className="table-wrap capped-table"><table aria-label="设备产能"><thead>
   <tr><th>设备</th><th>日产能</th><th>适用工件</th><th>停机时段</th><th>操作</th></tr>
  </thead><tbody>{machines.map(machine=><tr key={machine.id}>
   <td>{machine.name}<small className="cell-note">{machine.active?'启用':'停用'}</small></td>
   <td>{machine.capacity}</td><td>{machine.partCodes.join('、')}</td>
   <td>{machine.stops.map((item,i)=><small className="cell-note" key={i}>{item.date} {item.start}–{item.end}</small>)}</td>
   <td><button className="import" type="button" onClick={()=>open(machine)}>修改设备</button></td>
  </tr>)}</tbody></table></div>:<p className="compact-note">尚未配置设备。</p>}
  {draft&&<div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="设备设置"><form onSubmit={save}>
   <h3>设备设置</h3>
   <div className="row">
    <label>设备名称<input required maxLength={80} value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/></label>
    <label>设备日产能<input required type="number" min=".001" step="any" value={draft.capacity||''} onChange={event=>setDraft({...draft,capacity:Number(event.target.value)})}/></label>
   </div>
   <label><input type="checkbox" checked={draft.active} onChange={event=>setDraft({...draft,active:event.target.checked})}/> 设备启用</label>
   <label>搜索适用工件<input type="search" value={query} onChange={event=>setQuery(event.target.value)}/></label>
   <div className="checks" aria-label="适用工件">{parts.filter(part=>[part.code,part.name].some(value=>value.toLowerCase().includes(query.trim().toLowerCase()))).map(part=>
    <label key={part.code}><input type="checkbox" checked={draft.partCodes.includes(part.code)} onChange={event=>setDraft({...draft,partCodes:event.target.checked?[...draft.partCodes,part.code]:draft.partCodes.filter(code=>code!==part.code)})}/>{part.code} · {part.name}</label>)}</div>
   <p>已选择 {draft.partCodes.length} 项工件</p>
   {draft.stops.map((item,i)=><div className="row" key={i}><span>{item.date} {item.start}–{item.end}</span>
    <button className="import" type="button" onClick={()=>setDraft({...draft,stops:draft.stops.filter((_,index)=>index!==i)})}>移除停机</button></div>)}
   <div className="row">
    <label>停机日期<input type="date" value={stop.date} onChange={event=>setStop({...stop,date:event.target.value})}/></label>
    <label>开始<input type="time" aria-label="停机开始" value={stop.start} onChange={event=>setStop({...stop,start:event.target.value})}/></label>
    <label>结束<input type="time" aria-label="停机结束" value={stop.end} onChange={event=>setStop({...stop,end:event.target.value})}/></label>
   </div>
   <button className="import" type="button" onClick={addStop}>添加停机时段</button>
   {error&&<p role="alert" className="login-error">{error}</p>}
   <div className="dialog-actions"><button className="import" type="button" disabled={saving} onClick={()=>setDraft(null)}>取消</button><button className="primary" type="submit" disabled={saving}>保存设备</button></div>
  </form></div>}
 </section>;
}
