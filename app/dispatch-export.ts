import * as XLSX from 'xlsx';

type DispatchRow = {
  date: string; worker: string; orderNo: string; partCode: string; drawingNo?: string;
  name: string; amount: number; capacity: number; due: string; status: string; machineName?:string; startTime?:string; endTime?:string; operation?:string; quantity?:number; planStatus?:string;
};

export function buildDailyDispatch(factory:string,date:string,planStatus:string,rows:readonly DispatchRow[]){
  const selected=rows.filter(row=>row.date===date);
  const hasMachines=selected.some(row=>row.machineName);
  const hasOperations=selected.some(row=>row.operation);
  const entries=selected.map(row=>({
    工厂:factory, 加工日期:row.date, 开始时间:row.startTime||'', 结束时间:row.endTime||'', 人员:row.worker, ...(hasMachines?{设备:row.machineName||''}:{}), 订单号:row.orderNo,
    物料编码:row.partCode, 图号:row.drawingNo||'', 工件:row.name, 当天工作量:row.amount,
    日产能:row.capacity, 订单交期:row.due, 结果:row.status, 计划状态:row.planStatus||planStatus,
    ...(hasOperations?{工序:row.operation||'车工',派工件数:row.quantity??''}:{}),
  }));
  if(!entries.length)return null;
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(entries),'当日派工');
  return {workbook,filename:`${factory}-当日派工单-${date}.xlsx`};
}
