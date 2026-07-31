'use client';
import {useEffect,useMemo,useState} from 'react';
import * as XLSX from 'xlsx';

type Worker={id:string;name:string;team:string;capacity:number;overtime:number;skills:string[];active:boolean};
type Part={id:string,code:string,name:string,category:string,unit:number,workers:string[]};
type Order={id:string,orderNo:string,customer:string,partCode:string,name:string,qty:number,done:number,due:string,priority:number,status:string};
type Allocation={date:string,worker:string,orderNo:string,partCode:string,name:string,amount:number,capacity:number,due:string,status:string};
type ImportIssue={key:string,partCode:string,name:string,reason:string};
type AppState={workers:Worker[],parts:Part[],orders:Order[],allocations:Allocation[],lastRun:string,issues?:ImportIssue[],importedAt?:string};

const initial:AppState={workers:[
 {id:'w1',name:'王超伟',team:'车工一组',capacity:160,overtime:180,skills:['本体','底座','主轴'],active:true},
 {id:'w2',name:'杨战勋',team:'车工一组',capacity:160,overtime:180,skills:['本体','定位法兰','活塞'],active:true},
 {id:'w3',name:'郭涛',team:'车工一组',capacity:100,overtime:120,skills:['定位法兰','校准件','芯轴'],active:true},
 {id:'w4',name:'王双勃',team:'车工二组',capacity:110,overtime:130,skills:['上下顶尖','连接杆','旋转轴','芯杆'],active:true},
 {id:'w5',name:'李雷昭',team:'车工二组',capacity:100,overtime:120,skills:['防尘盖','活塞','散件','螺钉'],active:true},
],parts:[
 {id:'p1',code:'B02004872',name:'防转螺钉',category:'螺钉',unit:3.5,workers:['w5']},
 {id:'p2',code:'B02004875',name:'螺母',category:'散件',unit:10,workers:['w5']},
 {id:'p3',code:'B02004878',name:'上拉杆',category:'连接杆',unit:15,workers:['w4']},
 {id:'p4',code:'B05000280',name:'预置台底座',category:'底座',unit:25,workers:['w1','w2']},
],orders:[
 {id:'o1',orderNo:'MES-260731-01',customer:'常州塞创',partCode:'B02004872',name:'防转螺钉',qty:20,done:0,due:'2026-08-07',priority:1,status:'待排'},
 {id:'o2',orderNo:'MES-260731-02',customer:'重庆东龙',partCode:'B05000280',name:'预置台底座',qty:4,done:0,due:'2026-08-10',priority:2,status:'待排'},
 {id:'o3',orderNo:'MES-260731-03',customer:'格里森',partCode:'B02004878',name:'上拉杆',qty:10,done:2,due:'2026-08-12',priority:3,status:'待排'},
],allocations:[],lastRun:''};

const formatLocalDate=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const today=()=>formatLocalDate(new Date());
const addDay=(s:string,n=1)=>{const [year,month,day]=s.split('-').map(Number);const d=new Date(year,month-1,day);d.setDate(d.getDate()+n);return formatLocalDate(d)};
const workday=(s:string)=>{let x=s;while([0,6].includes(new Date(x+'T00:00:00').getDay()))x=addDay(x);return x};
const clean=(value:unknown)=>String(value??'').trim();
const excelDate=(value:unknown)=>{
 if(typeof value==='number'){const d=XLSX.SSF.parse_date_code(value);return d?`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`:''}
 const s=clean(value);if(!s)return '';const d=new Date(s);return Number.isNaN(d.getTime())?s.slice(0,10):formatLocalDate(d)
};
const numberFrom=(value:unknown)=>{const match=clean(value).match(/\d+(?:\.\d+)?/);return match?Number(match[0]):0};
const stableId=(...values:unknown[])=>'mes-'+values.map(v=>clean(v).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g,'-')).join('|');

function schedule(state:AppState,useOvertime=false){
 const loads=new Map<string,number>(),out:Allocation[]=[];
 const orders=[...state.orders].filter(o=>o.status!=='已完成').sort((a,b)=>a.priority-b.priority||a.due.localeCompare(b.due));
 for(const order of orders){
  const part=state.parts.find(p=>p.code===order.partCode); if(!part||part.unit<=0)continue;
  // Explicitly selected workers are a hard constraint. Category skills are
  // only a fallback for legacy parts that have no selected workers.
  const candidates=state.workers.filter(w=>w.active&&(part.workers.length
   ?part.workers.includes(w.id)
   :w.skills.some(s=>part.category.includes(s)||s.includes(part.category)))); if(!candidates.length)continue;
  let best:{w:Worker,finish:string,plan:{date:string,amount:number}[]}|null=null;
  for(const w of candidates){let remain=Math.max(0,order.qty-order.done)*part.unit,d=workday(today()),guard=0;const plan=[] as {date:string,amount:number}[];while(remain>.001&&guard++<400){const cap=useOvertime?w.overtime:w.capacity,k=w.id+'|'+d,avail=Math.max(0,cap-(loads.get(k)||0));if(avail){const amount=Math.min(avail,remain);plan.push({date:d,amount});remain-=amount}if(remain>.001)d=workday(addDay(d))}if(!best||d<best.finish)best={w,finish:d,plan}}
  if(!best)continue;for(const p of best.plan){const cap=useOvertime?best.w.overtime:best.w.capacity,k=best.w.id+'|'+p.date;loads.set(k,(loads.get(k)||0)+p.amount);out.push({date:p.date,worker:best.w.name,orderNo:order.orderNo,partCode:order.partCode,name:order.name,amount:p.amount,capacity:cap,due:order.due,status:p.date<=order.due?'按期':'延期'})}
 }
 return out.sort((a,b)=>a.date.localeCompare(b.date)||a.worker.localeCompare(b.worker));
}

export default function SchedulerApp(){
 const [data,setData]=useState<AppState>(initial),[tab,setTab]=useState('看板'),[loading,setLoading]=useState(true),[notice,setNotice]=useState('');
 const [workerForm,setWorkerForm]=useState({name:'',capacity:'',overtime:'',skills:''});
 const [partForm,setPartForm]=useState({code:'',name:'',category:'',unit:'',workers:[] as string[]});
 const [orderForm,setOrderForm]=useState({orderNo:'',customer:'',partCode:'',qty:'',due:'',priority:'3'});
 useEffect(()=>{fetch('/api/state').then(r=>r.ok?r.json():Promise.reject()).then(x=>setData(x.state||initial)).catch(()=>setData(initial)).finally(()=>setLoading(false))},[]);
 async function persist(next:AppState,msg='已保存'){setData(next);setNotice(msg);await fetch('/api/state',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(next)}).catch(()=>{});setTimeout(()=>setNotice(''),2200)}
 const metrics=useMemo(()=>{const pending=data.orders.filter(o=>o.status!=='已完成'),lateOrders=new Set(data.allocations.filter(a=>a.status==='延期').map(a=>a.orderNo));return{pending:pending.length,work:pending.reduce((s,o)=>{const p=data.parts.find(x=>x.code===o.partCode);return s+Math.max(0,o.qty-o.done)*(p?.unit||0)},0),late:lateOrders.size,util:data.allocations.length?Math.round(data.allocations.reduce((s,a)=>s+a.amount/a.capacity,0)/data.allocations.length*100):0}},[data]);
 async function run(){const allocations=schedule(data,false);await persist({...data,allocations,lastRun:new Date().toLocaleString('zh-CN')},`排产完成：生成 ${allocations.length} 条派工记录`);setTab('排产结果')}
 function addWorker(e:React.FormEvent){e.preventDefault();if(!workerForm.name)return;const w:Worker={id:crypto.randomUUID(),name:workerForm.name,team:'车工组',capacity:+workerForm.capacity||0,overtime:+workerForm.overtime||+workerForm.capacity||0,skills:workerForm.skills.split(/[、,，]/).map(x=>x.trim()).filter(Boolean),active:true};persist({...data,workers:[...data.workers,w]});setWorkerForm({name:'',capacity:'',overtime:'',skills:''})}
 function addPart(e:React.FormEvent){e.preventDefault();if(!partForm.code)return;const p:Part={id:crypto.randomUUID(),code:partForm.code,name:partForm.name,category:partForm.category,unit:+partForm.unit||0,workers:partForm.workers};persist({...data,parts:[...data.parts,p]});setPartForm({code:'',name:'',category:'',unit:'',workers:[]})}
 function addOrder(e:React.FormEvent){e.preventDefault();if(!orderForm.orderNo||!orderForm.partCode)return;const p=data.parts.find(x=>x.code===orderForm.partCode);const o:Order={id:crypto.randomUUID(),orderNo:orderForm.orderNo,customer:orderForm.customer,partCode:orderForm.partCode,name:p?.name||'',qty:+orderForm.qty||0,done:0,due:orderForm.due,priority:+orderForm.priority,status:'待排'};persist({...data,orders:[...data.orders,o]});setOrderForm({orderNo:'',customer:'',partCode:'',qty:'',due:'',priority:'3'})}
 async function importExcel(file:File){
  const book=XLSX.read(await file.arrayBuffer(),{cellDates:false});
  const pendingSheet=book.Sheets['工艺编制中'];
  const historySheet=book.Sheets['车工每日计划'];
  const capacitySheet=book.Sheets['专线列表及工时'];
  if(pendingSheet&&historySheet&&capacitySheet){
   const capacityRows=XLSX.utils.sheet_to_json<Record<string,unknown>>(capacitySheet,{defval:''});
   const workers=[...data.workers];let currentName='';
   for(const row of capacityRows){
    currentName=clean(row['人员'])||currentName;const skill=clean(row['加工种类']);if(!currentName||!skill)continue;
    const found=workers.find(w=>w.name===currentName);const capacity=numberFrom(row['8小时工时']),overtime=numberFrom(row['加班3小时工时']);
    if(found){if(!found.skills.includes(skill))found.skills.push(skill);if(capacity)found.capacity=capacity;if(overtime)found.overtime=overtime}
    else workers.push({id:stableId('worker',currentName),name:currentName,team:'车工组',capacity,overtime:overtime||capacity,skills:[skill],active:true});
   }
   const history=XLSX.utils.sheet_to_json<Record<string,unknown>>(historySheet,{defval:''});
   const partMap=new Map(data.parts.map(p=>[p.code,{...p,workers:[...p.workers]}]));currentName='';
   for(const row of history){
    currentName=clean(row['人员'])||currentName;const code=clean(row['物料编码']);if(!code)continue;
    const worker=workers.find(w=>w.name===currentName),unit=Number(row['单件工时'])||0,name=clean(row['名称']);
    const part=partMap.get(code)||{id:stableId('part',code),code,name,category:name,unit,workers:[]};
    if(unit&&!part.unit)part.unit=unit;if(worker&&!part.workers.includes(worker.id))part.workers.push(worker.id);partMap.set(code,part);
   }
   const pending=XLSX.utils.sheet_to_json<Record<string,unknown>>(pendingSheet,{defval:''});
   const imported:Order[]=[],issues:ImportIssue[]=[];
   pending.forEach((row,i)=>{const code=clean(row['物料编码']);if(!code)return;const name=clean(row['名称']),customer=clean(row['使用单位']),due=excelDate(row['计划完成']),start=excelDate(row['计划开始']),qty=Number(row['数量'])||0,unit=Number(row['单件工时'])||0;
    let part=partMap.get(code);if(!part){part={id:stableId('part',code),code,name,category:name,unit,workers:[]};partMap.set(code,part)}else if(unit&&!part.unit)part.unit=unit;
    const id=stableId('order',code,customer,start,due,i+2),orderNo=`MES-${code}-${due.replaceAll('-','')||'待定'}-${i+2}`;
    imported.push({id,orderNo,customer,partCode:code,name,qty,done:Number(row['已完成数量'])||0,due,priority:Number(row['优先级'])||3,status:'待排'});
    const reasons=[];if(!due)reasons.push('缺少交期');if(!qty)reasons.push('数量无效');if(!part.unit)reasons.push('缺少单件定额');if(!part.workers.length)reasons.push('无匹配人员');if(reasons.length)issues.push({key:id,partCode:code,name,reason:reasons.join('、')});
   });
   const incomingIds=new Set(imported.map(o=>o.id));const orders=[...data.orders.filter(o=>!o.id.startsWith('mes-order-')||!incomingIds.has(o.id)),...imported];
   await persist({...data,workers,parts:[...partMap.values()],orders,allocations:[],issues,importedAt:new Date().toLocaleString('zh-CN')},`MES周数据已更新：${imported.length} 项任务，${issues.length} 项待确认`);return;
  }
  const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(book.Sheets[book.SheetNames[0]],{defval:''}),byKey=new Map(data.orders.map(o=>[`${o.orderNo}|${o.partCode}`,o]));
  for(const [i,r] of rows.entries()){const code=clean(r['物料编码']??r['物料']);if(!code)continue;const p=data.parts.find(x=>x.code===code),orderNo=clean(r['订单号']??r['生产订单'])||`MES-${code}-${i+2}`,key=`${orderNo}|${code}`;byKey.set(key,{id:byKey.get(key)?.id||stableId('order',orderNo,code),orderNo,customer:clean(r['客户']??r['使用单位']),partCode:code,name:clean(r['名称']??p?.name),qty:Number(r['数量'])||0,done:Number(r['已完成数量'])||0,due:excelDate(r['交期']??r['计划完成']),priority:Number(r['优先级'])||3,status:'待排'})}
  await persist({...data,orders:[...byKey.values()],allocations:[]},`MES订单已增量更新，共 ${rows.length} 行`)
 }
 if(loading)return <main className="loading">正在载入排产数据…</main>;
 const tabs=['看板','订单管理','人员产能','工件定额','排产结果'];
 return <div className="shell">
  <aside><div className="brand"><span>序</span><div><b>序衡 APS</b><small>车间智能排产</small></div></div><nav>{tabs.map(x=><button key={x} className={tab===x?'active':''} onClick={()=>setTab(x)}>{x}</button>)}</nav><div className="side-note"><b>本周计划</b><span>滚动排产 · 第31周</span><i>MES 数据已连接</i></div></aside>
  <main><header><div><p>生产计划中心</p><h1>{tab}</h1></div><div className="header-actions"><label className="import">导入 MES Excel<input type="file" accept=".xlsx,.xls,.csv" onChange={e=>e.target.files?.[0]&&importExcel(e.target.files[0])}/></label><button className="primary" onClick={run}>▶ 自动排产</button></div></header>
  {notice&&<div className="toast">✓ {notice}</div>}
  {tab==='看板'&&<><section className="hero"><div><span>有限产能排产</span><h2>把交期、人员与每日产能<br/>放进同一张计划里</h2><p>系统按优先级和交期自动分配任务，识别延期，并给出加班或外协建议。</p><button onClick={run}>立即生成本周计划 →</button></div><div className="hero-stat"><small>当前排产覆盖率</small><strong>{data.orders.length?Math.round(data.allocations.length/Math.max(1,data.orders.length)*100):0}%</strong><em>{data.lastRun?`上次运行 ${data.lastRun}`:'尚未运行自动排产'}</em></div></section><section className="cards"><Metric label="待排订单" value={metrics.pending} note="来自MES与手工录入"/><Metric label="剩余工作量" value={metrics.work.toFixed(1)} note="按单件定额计算"/><Metric label="预计延期" value={metrics.late} note="需要加班或外协" danger={metrics.late>0}/><Metric label="平均日负荷" value={`${metrics.util}%`} note="已排派工记录"/></section><section className="panel"><div className="panel-title"><div><small>未来派工</small><h3>最近5条生产安排</h3></div><button onClick={()=>setTab('排产结果')}>查看全部</button></div><ScheduleTable rows={data.allocations.slice(0,5)}/></section></>}
  {tab==='人员产能'&&<div className="split"><section className="panel"><div className="panel-title"><div><small>基础资料</small><h3>人员与日产能</h3></div></div><table><thead><tr><th>人员</th><th>班组</th><th>正常产能</th><th>加班产能</th><th>适合加工</th><th>状态</th></tr></thead><tbody>{data.workers.map(w=><tr key={w.id}><td><b>{w.name}</b></td><td>{w.team}</td><td>{w.capacity}</td><td>{w.overtime}</td><td>{w.skills.join('、')}</td><td><span className="ok">参与排产</span></td></tr>)}</tbody></table></section><Form title="新增人员" onSubmit={addWorker}><input placeholder="姓名" value={workerForm.name} onChange={e=>setWorkerForm({...workerForm,name:e.target.value})}/><div className="row"><input type="number" placeholder="正常日产能" value={workerForm.capacity} onChange={e=>setWorkerForm({...workerForm,capacity:e.target.value})}/><input type="number" placeholder="加班日产能" value={workerForm.overtime} onChange={e=>setWorkerForm({...workerForm,overtime:e.target.value})}/></div><input placeholder="擅长类别，用逗号分隔" value={workerForm.skills} onChange={e=>setWorkerForm({...workerForm,skills:e.target.value})}/></Form></div>}
  {tab==='工件定额'&&<div className="split"><section className="panel"><div className="panel-title"><div><small>工艺资料</small><h3>工件定额与适配人员</h3></div></div><table><thead><tr><th>物料编码</th><th>名称</th><th>类别</th><th>单件工作量</th><th>可加工人员</th></tr></thead><tbody>{data.parts.map(p=><tr key={p.id}><td className="mono">{p.code}</td><td><b>{p.name}</b></td><td>{p.category}</td><td>{p.unit}</td><td>{p.workers.map(id=>data.workers.find(w=>w.id===id)?.name).filter(Boolean).join('、')}</td></tr>)}</tbody></table></section><Form title="新增工件" onSubmit={addPart}><input placeholder="物料编码" value={partForm.code} onChange={e=>setPartForm({...partForm,code:e.target.value})}/><input placeholder="工件名称" value={partForm.name} onChange={e=>setPartForm({...partForm,name:e.target.value})}/><div className="row"><input placeholder="加工类别" value={partForm.category} onChange={e=>setPartForm({...partForm,category:e.target.value})}/><input type="number" placeholder="单件工作量" value={partForm.unit} onChange={e=>setPartForm({...partForm,unit:e.target.value})}/></div><label>可加工人员</label><div className="checks">{data.workers.map(w=><label key={w.id}><input type="checkbox" checked={partForm.workers.includes(w.id)} onChange={e=>setPartForm({...partForm,workers:e.target.checked?[...partForm.workers,w.id]:partForm.workers.filter(x=>x!==w.id)})}/>{w.name}</label>)}</div></Form></div>}
  {tab==='订单管理'&&<div className="split"><section className="panel"><div className="panel-title"><div><small>订单池</small><h3>MES订单与临时插单</h3>{data.importedAt&&<small>最近一次周数据更新：{data.importedAt}</small>}</div>{data.issues?.length?<span className="late">{data.issues.length} 项待确认</span>:null}</div>{data.issues?.length?<div className="import-issues"><b>导入异常</b><span>{data.issues.slice(0,4).map(x=>`${x.partCode} ${x.reason}`).join('；')}{data.issues.length>4?'……':''}</span></div>:null}<table><thead><tr><th>优先级</th><th>订单号</th><th>客户</th><th>工件</th><th>数量</th><th>已完成</th><th>交期</th><th>状态</th></tr></thead><tbody>{data.orders.map(o=><tr key={o.id}><td><span className={`priority p${o.priority}`}>{o.priority}</span></td><td className="mono">{o.orderNo}</td><td>{o.customer}</td><td>{o.name}</td><td>{o.qty}</td><td>{o.done}</td><td>{o.due}</td><td>{data.issues?.some(x=>x.key===o.id)?<span className="late">待确认</span>:<span className="pending">{o.status}</span>}</td></tr>)}</tbody></table></section><Form title="新增订单 / 插单" onSubmit={addOrder}><input placeholder="订单号" value={orderForm.orderNo} onChange={e=>setOrderForm({...orderForm,orderNo:e.target.value})}/><input placeholder="客户" value={orderForm.customer} onChange={e=>setOrderForm({...orderForm,customer:e.target.value})}/><select value={orderForm.partCode} onChange={e=>setOrderForm({...orderForm,partCode:e.target.value})}><option value="">选择工件</option>{data.parts.map(p=><option key={p.id} value={p.code}>{p.code} · {p.name}</option>)}</select><div className="row"><input type="number" placeholder="数量" value={orderForm.qty} onChange={e=>setOrderForm({...orderForm,qty:e.target.value})}/><select value={orderForm.priority} onChange={e=>setOrderForm({...orderForm,priority:e.target.value})}><option value="1">紧急</option><option value="2">交期必保</option><option value="3">普通</option></select></div><label>要求完成日期</label><input type="date" value={orderForm.due} onChange={e=>setOrderForm({...orderForm,due:e.target.value})}/></Form></div>}
  {tab==='排产结果'&&<section className="panel"><div className="panel-title"><div><small>自动计算结果</small><h3>每日派工计划</h3></div><div className="legend"><i className="green"/>按期 <i className="red"/>延期</div></div>{data.allocations.length?<ScheduleTable rows={data.allocations}/>:<div className="empty"><b>尚未生成计划</b><span>点击右上角“自动排产”开始计算。</span></div>}</section>}
  </main>
 </div>
}
function Metric({label,value,note,danger=false}:{label:string,value:string|number,note:string,danger?:boolean}){return <div className={`metric ${danger?'danger':''}`}><small>{label}</small><strong>{value}</strong><span>{note}</span></div>}
function Form({title,onSubmit,children}:{title:string,onSubmit:(e:React.FormEvent)=>void,children:React.ReactNode}){return <form className="form-panel" onSubmit={onSubmit}><small>主动录入</small><h3>{title}</h3>{children}<button className="primary" type="submit">保存资料</button></form>}
function ScheduleTable({rows}:{rows:Allocation[]}){return <div className="table-wrap"><table><thead><tr><th>加工日期</th><th>人员</th><th>订单号</th><th>物料编码</th><th>工件</th><th>当天安排量</th><th>负荷</th><th>订单交期</th><th>结果</th></tr></thead><tbody>{rows.map((a,i)=><tr key={i}><td><b>{a.date}</b></td><td>{a.worker}</td><td className="mono">{a.orderNo}</td><td className="mono">{a.partCode}</td><td>{a.name}</td><td>{a.amount.toFixed(1)}</td><td><div className="bar"><i style={{width:`${Math.min(100,a.amount/a.capacity*100)}%`}}/></div></td><td>{a.due}</td><td><span className={a.status==='按期'?'ok':'late'}>{a.status}</span></td></tr>)}</tbody></table></div>}
