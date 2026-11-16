import {useEffect,useRef} from 'react';
import type {reviewExcelImport} from './excel-import-review';

export function ExcelImportPreview({fileName,factory,note,review,saving,onConfirm,onCancel}:{
 fileName:string;factory:string;note?:string;review:ReturnType<typeof reviewExcelImport>;saving:boolean;onConfirm:()=>void;onCancel:()=>void;
}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const element=dialog.current;if(element&&!element.open)element.showModal()},[]);
 return <dialog ref={dialog} className="excel-import-dialog" aria-labelledby="excel-preview-title" onCancel={event=>{event.preventDefault();if(!saving)onCancel()}}>
  <form className="password-dialog" onSubmit={event=>{event.preventDefault();onConfirm()}}>
   <h3 id="excel-preview-title">Excel 导入预览</h3>
   <p>{factory} · {fileName}</p>
   {note&&<p>{note}</p>}
   <p>新增 {review.changes.filter(item=>item.kind==='新增').length} 项 · 变更 {review.changes.filter(item=>item.kind==='变更').length} 项 · 移出 {review.changes.filter(item=>item.kind==='移出').length} 项 · 派工冲突 {review.conflicts.length} 项</p>
   <p>确认后更新数据，保留已有派工和历史计划。</p>
   {review.conflicts.length>0&&<section className="import-issues"><b>需要核对的派工</b><ul>{review.conflicts.map(issue=><li key={issue.key}>{issue.orderNo} · {issue.partCode}：{issue.reason}</li>)}</ul></section>}
   {review.changes.length>0&&<div className="table-wrap capped-table"><table><thead><tr><th>操作</th><th>订单 / 工序</th><th>内容</th></tr></thead><tbody>{review.changes.map(item=><tr key={item.key}><td>{item.kind}</td><td>{item.label}</td><td className="wrap-cell">{item.detail}</td></tr>)}</tbody></table></div>}
   <div className="dialog-actions"><button autoFocus className="import" type="button" disabled={saving} onClick={onCancel}>取消导入</button><button className="primary" type="submit" disabled={saving}>{saving?'正在保存…':'确认导入'}</button></div>
  </form>
 </dialog>;
}
