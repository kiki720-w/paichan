import {validCalendarDate} from './production-calendar';

export type DeliveryBatch={label:string;quantity:number;due:string};

export function validateDeliveryBatches(batches:DeliveryBatch[],planned:number,done:number){
 if(batches.length<2||batches.length>30)throw Error('请填写 2 至 30 个交付批次。');
 const labels=new Set<string>();
 let total=0;
 const sorted=batches.map(batch=>{
  const label=batch.label.trim();
  if(!label||label.length>50||labels.has(label))throw Error('每个批次须有不同的批次号，最多 50 字。');
  if(!Number.isFinite(batch.quantity)||batch.quantity<=0)throw Error('批次数量必须为正数。');
  if(!validCalendarDate(batch.due))throw Error('请填写有效的批次交期。');
  total+=batch.quantity;
  labels.add(label);
  return {...batch,label};
 }).sort((a,b)=>a.due.localeCompare(b.due));
 if(!Number.isFinite(total)||!Number.isFinite(planned)||!Number.isFinite(done)||done<0||total>planned-done+.000001){
  throw Error('批次数量合计不能超过订单剩余数量。');
 }
 return sorted;
}

export function forecastDeliveryBatches(batches:DeliveryBatch[],unit:number,rows:readonly {date:string;amount:number}[]){
 if(!Number.isFinite(unit)||unit<=0)throw Error('缺少有效单件工时，无法预测交付批次。');
 const days=[...rows].sort((a,b)=>a.date.localeCompare(b.date));
 let index=0,unused=0;
 return batches.map(batch=>{
  let remaining=batch.quantity,last:string|null=null;
  while(remaining>.000001&&(unused>0||index<days.length)){
   if(unused===0){unused=days[index++].amount/unit;if(!Number.isFinite(unused)||unused<=0){unused=0;continue;}}
   const piece=Math.min(remaining,unused);
   unused-=piece;remaining-=piece;last=days[index-1].date;
  }
  return {...batch,finish:remaining<=.000001?last:null,scheduled:batch.quantity-remaining};
 });
}
