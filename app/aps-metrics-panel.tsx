import {useState} from 'react';

export function ApsMetricsPanel({factory}:{factory:string}){
 const [counts,setCounts]=useState<Record<string,number>|null>(null),[notice,setNotice]=useState('');
 async function load(){
  setNotice('正在读取统计');
  try{
   const response=await fetch('/api/aps-metrics?factory='+factory,{cache:'no-store'});
   const result=await response.json();
   if(!response.ok)throw Error(result.message||'读取统计失败。');
   setCounts(result.counts);setNotice('');
  }catch(error){setNotice((error as Error).message);}
 }
 return <details className="panel" onToggle={event=>{if(event.currentTarget.open)void load();}}>
  <summary>最近 30 天异常处置统计</summary>
  {notice&&<p role="status">{notice}</p>}
  {counts&&<div className="table-wrap"><table><thead><tr>{Object.keys(counts).map(label=><th key={label}>{label}</th>)}</tr></thead>
   <tbody><tr>{Object.entries(counts).map(([label,value])=><td key={label}>{value}</td>)}</tr></tbody>
  </table></div>}
 </details>;
}
