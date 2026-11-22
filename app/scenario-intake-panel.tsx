import {useRef,useState} from 'react';
import * as XLSX from 'xlsx';
import type {AppState} from './scheduler-app';
import type {SchedulingScenario} from './scheduling-scenarios';
import {buildScenarioTemplate,readScenarioWorkbook,scanScenarioFields,scenarioFromFields,type IntakeField} from './scenario-intake';

export function ScenarioIntakePanel({factory,state,onApply}:{factory:string;state:AppState;onApply:(scenario:SchedulingScenario)=>void}){
 const [fields,setFields]=useState<IntakeField[]>([]),[raw,setRaw]=useState(''),[confirmed,setConfirmed]=useState<string[]>([]);
 const [progress,setProgress]=useState(''),[notice,setNotice]=useState(''),[fileName,setFileName]=useState('');
 const request=useRef(0);
 function update(key:string,value:string){
  setFields(current=>current.map(field=>field.key===key?{...field,value}:field));
  setConfirmed(current=>current.filter(item=>item!==key));
 }
 async function read(file:File){
  const id=++request.current;
  setNotice('');setFields([]);setConfirmed([]);setRaw('');setFileName(file.name);
  setProgress('正在读取附件');
  try{
   if(file.size>15*1024*1024)throw Error('附件最大 15 MB。');
   if(/\.xlsx?$/i.test(file.name)){
    const data=readScenarioWorkbook(await file.arrayBuffer(),factory);
    if(request.current===id)setFields(data);
   }else if(/\.(pdf|png|jpe?g|webp)$/i.test(file.name)){
    const {captureScenarioDocument}=await import('./scenario-capture');
    const capture=await captureScenarioDocument(file,message=>{if(request.current===id)setProgress(message);});
    if(request.current===id){setRaw(capture.text);setFields(scanScenarioFields(capture.text,capture.confidence));}
   }else throw Error('请选择 Excel、PDF、PNG、JPG 或 WebP 文件。');
  }catch(error){if(request.current===id)setNotice((error as Error).message);}
  finally{if(request.current===id)setProgress('');}
 }
 function apply(){
  setNotice('');
  try{
   if(fields.some(field=>field.value.trim()&&!confirmed.includes(field.key)))throw Error('请逐项确认有值的字段。');
   onApply(scenarioFromFields(fields,state,factory));
   setNotice('已带入情景，可在上方生成对比。');
  }catch(error){setNotice((error as Error).message);}
 }
 return <details className="panel">
  <summary>从附件填写情景</summary>
  <div className="compact-toolbar">
   <button type="button" onClick={()=>XLSX.writeFile(buildScenarioTemplate(factory),'序衡-情景导入模板.xlsx')}>下载 Excel 模板</button>
   <label>选择 Excel、PDF 或图片<input type="file" accept=".xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp" onChange={event=>{
    const file=event.target.files?.[0];event.target.value='';if(file)void read(file);
   }}/></label>
  </div>
  {progress&&<p role="status">{progress}</p>}
  {fields.length>0&&<div className="form-panel">
   <p className="compact-note">{fileName} · 核对附件中每个填入的字段</p>
   <div className="table-wrap"><table><thead><tr><th>字段</th><th>识别值</th><th>识别置信度</th><th>确认</th></tr></thead><tbody>
    {fields.map(field=><tr key={field.key}><th scope="row">{field.key}</th><td><input aria-label={field.key} value={field.value} onChange={event=>update(field.key,event.target.value)}/></td>
     <td>{field.confidence===null?'—':Math.round(field.confidence)+'%'+(field.confidence<85?' · 请核对':'')}</td>
     <td><input type="checkbox" aria-label={'确认'+field.key} disabled={!field.value.trim()} checked={confirmed.includes(field.key)}
      onChange={event=>setConfirmed(items=>event.target.checked?[...items,field.key]:items.filter(item=>item!==field.key))}/></td></tr>)}
   </tbody></table></div>
   {raw&&<details><summary>查看识别原文</summary><textarea readOnly aria-label="识别原文" value={raw}/></details>}
   <button type="button" className="primary" onClick={apply}>确认字段并带入情景</button>
  </div>}
  {notice&&<p role="status">{notice}</p>}
 </details>;
}
