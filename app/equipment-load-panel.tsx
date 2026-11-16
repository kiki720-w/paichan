import {useState} from 'react';
import {machineDailyLoad,type Machine} from './equipment-capacity';
import {validCalendarDate,type CalendarEntry} from './production-calendar';
import type {Allocation,ScheduleShortage} from './scheduler-app';

const decimal=new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2});

export function EquipmentLoadPanel({today,machines,rows,shortages,windows,calendar,onPlan}:{
 today:string;machines:Machine[];rows:Allocation[];shortages:ScheduleShortage[];windows?:string;calendar?:CalendarEntry[];onPlan:(date:string)=>void;
}){
 const [selected,setSelected]=useState('');
 const date=validCalendarDate(selected)?selected:today;
 const loads=machines.map(machine=>({machine,...machineDailyLoad(machine,date,rows,windows,calendar)}));
 const bottleneckCount=loads.filter(load=>load.machine.active&&load.working&&load.remainingWork===0).length;
 return <section className="panel" aria-labelledby="equipment-load-title">
  <div className="panel-title"><div><small>按天查看设备可用时段</small><h3 id="equipment-load-title">设备负荷与瓶颈</h3></div>
   {loads.length>0&&<div className="row equipment-load-controls"><label>设备负荷日期 <input type="date" value={date} onChange={event=>setSelected(event.target.value)}/></label><button type="button" className="import" onClick={()=>onPlan(date)}>查看当天派工</button></div>}
  </div>
  {loads.length===0?<div className="empty">请先在业务规则中设置设备。</div>:<>
   {bottleneckCount>0&&<p className="import-issues">当天有 {bottleneckCount} 台启用设备无可排产能，请核对下表原因。</p>}
   {!windows&&<p className="compact-note">请在排产结果设置工作时段，才能计算设备剩余产能。</p>}
   <div className="table-wrap"><table className="equipment-load-table"><thead><tr><th>设备</th><th>已占用量</th><th>剩余产能</th><th>停机时段</th><th>状态及关联缺口</th></tr></thead><tbody>
    {loads.map(load=>{
     const {machine}=load;
     const related=shortages.filter(item=>item.remainingWork>.001&&machine.partCodes.includes(item.partCode));
     const status=!machine.active?'已停用':!load.working?'非生产日':!machine.capacity?'缺少设备产能':load.unassigned||load.missingTimes?'派工待核对':load.availableWork===null?'待设置工作时段':load.availableMinutes===0?'工作时段停机':load.remainingWork===0?'已排满':'可安排';
     return <tr key={machine.id}><th scope="row">{machine.name}</th>
      <td>{decimal.format(load.occupiedWork)} <small>标准工作量</small><small className="cell-note">{decimal.format(load.occupiedMinutes/60)} 小时{load.missingTimes>0?'（部分派工缺时段）':''}</small></td>
      <td>{load.remainingWork===null?'—':decimal.format(load.remainingWork)}{load.remainingWork!==null&&<small> 标准工作量</small>}</td>
      <td>{load.downtime.length?load.downtime.join('、'):'—'}</td>
      <td><span className={status==='可安排'?'ok':load.remainingWork===0&&machine.active&&load.working?'late':'pending'}>{status}</span>
       {load.unassigned>0&&<small className="cell-note">{load.unassigned} 条适配派工未指定设备</small>}
       {related.length>0&&<details><summary>关联缺口 {related.length} 项</summary><ul>{related.map(item=><li key={item.orderId||JSON.stringify([item.orderNo,item.partCode])}>{item.orderNo} · {item.partCode} · 未排 {decimal.format(item.remainingWork)}</li>)}</ul></details>}
      </td>
     </tr>;
    })}
   </tbody></table></div>
   <p className="compact-note">剩余产能按设备空闲工作时段折算。关联缺口按设备可加工物料匹配，订单能否排入还取决于人员和交期。</p>
  </>}
 </section>;
}
