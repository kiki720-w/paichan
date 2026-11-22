import {useState} from 'react';
import type {AppState} from './scheduler-app';
import {dispatchProgressRisks} from './dispatch-progress-risk';
import {DispatchExceptionsPanel} from './dispatch-exceptions-panel';

const displayTime=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const qty=(value:number)=>value.toLocaleString('zh-CN',{maximumFractionDigits:3});

export function DispatchProgressPanel({state,factory,onScenario,onTolerance}:{state:AppState;factory:string;
 onScenario:(orderId:string)=>void;onTolerance:(tolerance:number)=>Promise<boolean>;
}){
 const [at,setAt]=useState(()=>new Date().toISOString()),[tolerance,setTolerance]=useState(String(state.progressTolerance??0));
 const [saving,setSaving]=useState(false);
 const {gaps,blocked,predicted}=dispatchProgressRisks(state,at);
 return <><section className="panel" aria-label="派工进度核对">
  <div className="panel-title"><div><h3>派工进度核对</h3><small>检测时间 {displayTime(at)} · 北京时间</small></div>
   <button type="button" onClick={()=>setAt(new Date().toISOString())}>重新检查</button>
  </div>
  <form className="compact-toolbar" onSubmit={async event=>{
   event.preventDefault();setSaving(true);
   try{if(await onTolerance(Number(tolerance)))setAt(new Date().toISOString());}
   finally{setSaving(false);}
  }}>
   <label>本厂允许落后件数 <input required type="number" min="0" step="1" value={tolerance} onChange={event=>setTolerance(event.target.value)}/></label>
   <button type="submit" disabled={saving||!tolerance||Number(tolerance)===(state.progressTolerance??0)}>保存容差</button>
  </form>
  <p className="compact-note">比较已发布派工的应完工量和当前累计完工量。当天没有登记结束时间的派工在次日核对。</p>
  {gaps.length?<div className="table-wrap capped-table"><table><thead><tr><th>工单 / 物料</th><th>应完工</th><th>已完工</th><th>落后</th><th>完工量来源</th><th>计划版本</th><th>操作</th></tr></thead>
   <tbody>{gaps.map(item=><tr key={item.key}><td>{item.orderNo} · {item.partCode}{item.operation?` · ${item.operation}`:''}</td><td>{qty(item.expected)}</td><td>{qty(item.actual)}</td><td className="late">{qty(item.gap)}</td><td>{item.source}{item.reportedAt?<small> · {item.reportedAt}</small>:null}</td><td>{item.version}</td><td>{item.orderId?<button type="button" onClick={()=>onScenario(item.orderId!)}>试算交期</button>:'—'}</td></tr>)}</tbody>
  </table></div>:<p className="compact-note">当前未发现超出容差的进度差额。</p>}
  {predicted.length>0&&<div className="table-wrap capped-table"><table><caption>预计延期</caption>
   <thead><tr><th>工单 / 物料</th><th>剩余件数</th><th>交期</th><th>预计完工日</th><th>来源</th><th>操作</th></tr></thead>
   <tbody>{predicted.map(item=><tr key={item.key}><td>{item.orderNo} · {item.partCode}</td><td>{qty(item.remaining)}</td>
    <td>{item.due}</td><td className="late">{item.expectedFinish}</td><td>{item.source}</td>
    <td>{item.orderId?<button type="button" onClick={()=>onScenario(item.orderId!)}>试算交期</button>:'—'}</td></tr>)}</tbody>
  </table></div>}
  {blocked.length>0&&<details open><summary>无法核对的派工 {blocked.length} 项</summary><ul>{blocked.map(item=><li key={item.key}>{item.orderNo} · {item.partCode} · {item.reason}</li>)}</ul></details>}
 </section><DispatchExceptionsPanel key={state.progressTolerance??0} factory={factory} subjects={[...gaps,...blocked,...predicted]}/></>;
}
