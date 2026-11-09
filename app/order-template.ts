import * as XLSX from 'xlsx';

export function buildOrderTemplate(){
 const book=XLSX.utils.book_new();
 const sheet=XLSX.utils.aoa_to_sheet([['订单号','物料编码','名称','图号','数量','已完成数量','交期','单件工时','客户','优先级','工厂']]);
 sheet['!cols']=[16,16,18,16,9,12,16,12,18,9,14].map(wch=>({wch}));
 XLSX.utils.book_append_sheet(book,sheet,'订单导入');
 const notes=XLSX.utils.aoa_to_sheet([
  ['字段','填写要求'],
  ['订单号、物料编码、名称、图号','填写实际资料，编码有前导零时请按文本填写。'],
  ['数量、已完成数量','数量为正数；未完成时填 0，完成量不能超过数量。'],
  ['交期','填写 YYYY-MM-DD，例如 2026-12-01。'],
  ['单件工时','填写正数，单位与序衡现有工件定额一致。'],
  ['优先级','1 = 紧急，2 = 交期必保，3 = 普通。'],
  ['工厂','填写西安或兴平，应与当前工厂一致。'],
  ['导入方式','把实际订单填入第一张表；不要改表头。当前工厂数据会在导入后更新。'],
 ]);
 notes['!cols']=[24,72].map(wch=>({wch}));
 XLSX.utils.book_append_sheet(book,notes,'填写说明');
 return book;
}
