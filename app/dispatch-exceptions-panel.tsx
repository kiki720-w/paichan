import {useEffect,useState,type FormEvent} from 'react';
import {exceptionNextStages,type DispatchExceptionEvent,type ExceptionStage} from './dispatch-exceptions';

type Subject=Pick<DispatchExceptionEvent,'key'|'orderNo'|'partCode'|'operation'|'version'>;
const stages:ExceptionStage[]=['待处理','分析中','待确认','已解决','已忽略'];
const localTime=(at:string)=>new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});

export function DispatchExceptionsPanel({factory,subjects}:{factory:string;subjects:Subject[]}){
 const endpoint='/api/dispatch-exceptions?factory='+factory;
 const [saved,setSaved]=useState<DispatchExceptionEvent[]>([]),[history,setHistory]=useState<DispatchExceptionEvent[]>([]);
 const [status,setStatus]=useState<ExceptionStage|''>(''),[selected,setSelected]=useState<Subject|null>(null);
 const [next,setNext]=useState<ExceptionStage|''>('');
 const [reason,setReason]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [refresh,setRefresh]=useState(0),[ready,setReady]=useState(false);
 useEffect(()=>{
  const cancel=new AbortController();
  async function load(){
   try{
    const response=await fetch(endpoint,{cache:'no-store',signal:cancel.signal});
    const result=await response.json();
    if(!response.ok)throw Error(result.message||'读取异常记录失败。');
    if(!cancel.signal.aborted){setSaved(result.events);setReady(true);}
   }catch(error){if(!cancel.signal.aborted)setNotice(error instanceof Error?error.message:'读取异常记录失败。');}
  }
  void load();
  return ()=>cancel.abort();
 },[endpoint,refresh]);
 const selectedKey=selected?.key;
 useEffect(()=>{
  if(!selectedKey)return;
  const url=endpoint+'&key='+encodeURIComponent(selectedKey);
  const cancel=new AbortController();
  async function load(){
   try{
    const response=await fetch(url,{cache:'no-store',signal:cancel.signal});
    const result=await response.json();
    if(!response.ok)throw Error(result.message||'读取处理记录失败。');
    if(!cancel.signal.aborted)setHistory(result.events);
   }catch(error){if(!cancel.signal.aborted)setNotice(error instanceof Error?error.message:'读取处理记录失败。');}
  }
  void load();
  return ()=>cancel.abort();
 },[endpoint,selectedKey,refresh]);
 const latest=new Map(saved.map(item=>[item.key,item]));
 const rows=[...new Map([...subjects,...saved].map(item=>[item.key,item])).values()]
  .filter(item=>!status||status===(latest.get(item.key)?.stage||'待处理'));
 const stage=selected?(latest.get(selected.key)?.stage||'待处理'):null;
 const moves=stage?exceptionNextStages(stage):[];
 function select(item:Subject){
  if(item.key===selectedKey)return;
  setSelected(item);setNext('');setReason('');setHistory([]);setNotice('');
 }
 async function submit(event:FormEvent){
  event.preventDefault();
  if(!selected||!next||busy||!moves.includes(next))return;
  setBusy(true);setNotice('');
  try{
   const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
    key:selected.key,sequence:latest.get(selected.key)?.sequence||0,stage:next,reason,
   })});
   const result=await response.json();
   if(!response.ok){if(response.status===409)setRefresh(value=>value+1);throw Error(result.message||'保存异常处理失败。');}
   setSaved(items=>[result.event,...items.filter(item=>item.key!==selected.key)]);
   setNext('');setReason('');setRefresh(value=>value+1);setNotice('已保存处理记录。');
  }catch(error){setNotice(error instanceof Error?error.message:'保存异常处理失败。');}
  finally{setBusy(false);}
 }
 return <section className="panel" aria-label="派工异常工作台">
  <div className="panel-title"><h3>派工异常工作台</h3><label>处理状态 <select value={status} onChange={event=>setStatus(event.target.value as ExceptionStage|'')}><option value="">全部</option>{stages.map(item=><option key={item}>{item}</option>)}</select></label></div>
  {!ready&&(notice?<button type="button" onClick={()=>{setNotice('');setRefresh(value=>value+1);}}>重新读取</button>:<p className="compact-note">正在读取处理记录。</p>)}
  {ready&&(!rows.length?<p className="compact-note">当前没有符合筛选条件的派工异常。</p>:<div className="table-wrap capped-table"><table><thead><tr><th>工单 / 物料</th><th>计划版本</th><th>处理状态</th><th>操作</th></tr></thead>
   <tbody>{rows.map(item=><tr key={item.key}><td>{item.orderNo} · {item.partCode}{item.operation?` · ${item.operation}`:''}</td><td>{item.version}</td><td>{latest.get(item.key)?.stage||'待处理'}</td><td><button type="button" disabled={busy} onClick={()=>select(item)}>查看处理</button></td></tr>)}</tbody>
  </table></div>)}
  {selected&&<div className="form-panel"><h4>{selected.orderNo} · {selected.partCode} · {stage}</h4>
   {moves.length>0&&<form className="form-panel" onSubmit={submit}><label>操作 <select required value={next} onChange={event=>setNext(event.target.value as ExceptionStage|'')}><option value="">请选择</option>{moves.map(item=><option key={item}>{item}</option>)}</select></label>
    <label>处理原因 <textarea maxLength={500} required={next==='已解决'||next==='已忽略'} value={reason} onChange={event=>setReason(event.target.value)}/></label>
    <button type="submit" className="primary" disabled={busy||!next||!moves.includes(next)}>保存处理结果</button>
   </form>}
   {history.length>0&&<ul>{history.map(item=><li key={item.id}>{localTime(item.at)} · {item.actor} · {item.stage}{item.reason?' · '+item.reason:''}</li>)}</ul>}
  </div>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
