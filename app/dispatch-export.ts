import * as XLSX from 'xlsx';

type DispatchRow = {
  date: string; worker: string; orderNo: string; partCode: string; drawingNo?: string;
  name: string; amount: number; capacity: number; due: string; status: string;
};

export function buildDailyDispatch(factory:string,date:string,planStatus:string,rows:readonly DispatchRow[]){
  const entries=rows.filter(row=>row.date===date).map(row=>({
    工厂:factory, 加工日期:row.date, 人员:row.worker, 订单号:row.orderNo,
    物料编码:row.partCode, 图号:row.drawingNo||'', 工件:row.name, 当天工作量:row.amount,
    日产能:row.capacity, 订单交期:row.due, 结果:row.status, 计划状态:planStatus,
  }));
  if(!entries.length)return null;
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(entries),'当日派工');
  return {workbook,filename:`${factory}-当日派工单-${date}.xlsx`};
}
