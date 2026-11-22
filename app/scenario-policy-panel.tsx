import {useState,type FormEvent} from 'react';
import {planStatuses,scenarioKinds,type ScenarioPolicy} from './scenario-policy';

const names={insert:'紧急插单',leave:'人员请假',due:'调整交期',split:'分批交付'};

export function ScenarioPolicyPanel({policy,onSave}:{policy:ScenarioPolicy;onSave:(policy:ScenarioPolicy)=>Promise<void>}){
 const [settings,setSettings]=useState(policy),[notice,setNotice]=useState(''),[saving,setSaving]=useState(false);
 async function submit(event:FormEvent){
  event.preventDefault();setNotice('');setSaving(true);
  try{await onSave(settings);}
  catch(error){setNotice((error as Error).message);}
  finally{setSaving(false);}
 }
 return <form className="form-panel" onSubmit={submit}>
  <p className="compact-note">试算结果符合全部条件时自动保存草稿。确认和发布由本厂负责人操作。</p>
  <label><input type="checkbox" checked={settings.enabled} onChange={event=>setSettings({...settings,enabled:event.target.checked})}/>启用自动保存</label>
  <fieldset><legend>允许情景</legend>{scenarioKinds.map(kind=><label key={kind}><input type="checkbox" checked={settings.eventTypes.includes(kind)} onChange={event=>setSettings({...settings,eventTypes:event.target.checked?[...settings.eventTypes,kind]:settings.eventTypes.filter(item=>item!==kind)})}/>{names[kind]}</label>)}</fieldset>
  <div className="row">
   <label>最多影响订单数<input type="number" min="0" max="10000" required value={settings.maxChanged} onChange={event=>setSettings({...settings,maxChanged:Number(event.target.value)})}/></label>
   <label>最长顺延天数<input type="number" min="0" max="30" required value={settings.maxDelayDays} onChange={event=>setSettings({...settings,maxDelayDays:Number(event.target.value)})}/></label>
   <label>数据有效期（小时）<input type="number" min="1" max="168" required value={settings.maxAgeHours} onChange={event=>setSettings({...settings,maxAgeHours:Number(event.target.value)})}/></label>
  </div>
  <label><input type="checkbox" checked={settings.allowOvertime} onChange={event=>setSettings({...settings,allowOvertime:event.target.checked})}/>允许含加班的草稿</label>
  <fieldset><legend>禁止自动保存的计划状态</legend>{planStatuses.map(status=><label key={status}><input type="checkbox" checked={settings.excludedStatuses.includes(status)} onChange={event=>setSettings({...settings,excludedStatuses:event.target.checked?[...settings.excludedStatuses,status]:settings.excludedStatuses.filter(item=>item!==status)})}/>{status}</label>)}</fieldset>
  <button type="submit" className="primary" disabled={saving}>保存策略</button>
  {notice&&<p role="alert">{notice}</p>}
 </form>;
}
