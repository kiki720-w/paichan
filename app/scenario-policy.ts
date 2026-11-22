import type {SchedulingScenario} from './scheduling-scenarios';

export const scenarioKinds=['insert','leave','due','split'] as const;
export const planStatuses=['草稿','已确认','已发布','已撤回','已变更'] as const;

export type ScenarioPolicy={
 version:number;enabled:boolean;eventTypes:SchedulingScenario['kind'][];
 maxChanged:number;maxDelayDays:number;maxAgeHours:number;allowOvertime:boolean;excludedStatuses:string[];
};
export const defaultScenarioPolicy:ScenarioPolicy={
 version:0,enabled:false,eventTypes:[],maxChanged:5,maxDelayDays:1,maxAgeHours:24,allowOvertime:false,
 excludedStatuses:['已确认','已发布'],
};

type Review={
 event:SchedulingScenario['kind'];planStatus:string;sourceAt:string;now:number;conflicts:number;blocked:number;rows:number;
 overtimeWork:number;comparison:{beforeDue:string|null;beforeFinish:string|null;finish:string|null;normalChanged:boolean;notReady:boolean}[];
};

export function reviewScenarioPolicy(policy:ScenarioPolicy,review:Review){
 const reasons:string[]=[];
 if(!policy.enabled)reasons.push('策略尚未启用');
 if(!policy.eventTypes.includes(review.event))reasons.push('情景类型未获准自动保存');
 if(policy.excludedStatuses.includes(review.planStatus))reasons.push('当前计划状态禁止自动保存');
 const source=Date.parse(review.sourceAt);
 if(!Number.isFinite(source)||source>review.now)reasons.push('缺少可核对的来源时间');
 else if(review.now-source>policy.maxAgeHours*3600000)reasons.push('来源数据已过期');
 if(review.conflicts)reasons.push('存在现有派工冲突');
 if(review.blocked||review.comparison.some(row=>row.notReady))reasons.push('存在资料待确认');
 if(!review.rows)reasons.push('没有可保存的六日派工');
 if(review.overtimeWork>.001&&!policy.allowOvertime)reasons.push('当前策略没有允许加班');
 const changed=review.comparison.filter(row=>row.beforeDue&&row.normalChanged);
 if(changed.length>policy.maxChanged)reasons.push('受影响任务数超过上限');
 const delay=(before:string,after:string)=>Math.max(0,(Date.parse(after)-Date.parse(before))/86400000);
 if(changed.some(row=>!row.beforeFinish||!row.finish||delay(row.beforeFinish,row.finish)>policy.maxDelayDays)){
  reasons.push('预计顺延超限或无法核对');
 }
 return {allowed:reasons.length===0,version:policy.version,reasons};
}

export function normalizeScenarioPolicy(input:unknown):Omit<ScenarioPolicy,'version'>{
 const value=input as Partial<ScenarioPolicy>|null;
 const integer=(number:unknown,minimum:number,maximum:number)=>typeof number==='number'&&Number.isInteger(number)&&number>=minimum&&number<=maximum;
 if(!value||typeof value.enabled!=='boolean'||typeof value.allowOvertime!=='boolean'||
  !Array.isArray(value.eventTypes)||value.eventTypes.some(kind=>!scenarioKinds.includes(kind))||
  !Array.isArray(value.excludedStatuses)||value.excludedStatuses.some(status=>!(planStatuses as readonly string[]).includes(status))||
  !integer(value.maxChanged,0,10000)||!integer(value.maxDelayDays,0,30)||!integer(value.maxAgeHours,1,168)){
  throw Error('请检查策略类型、影响任务数、顺延天数和数据有效期。');
 }
 if(value.enabled&&!value.eventTypes.length)throw Error('启用前至少选择一种情景。');
 return {enabled:value.enabled,allowOvertime:value.allowOvertime,eventTypes:[...new Set(value.eventTypes)],excludedStatuses:[...new Set(value.excludedStatuses)],
  maxChanged:value.maxChanged!,maxDelayDays:value.maxDelayDays!,maxAgeHours:value.maxAgeHours!};
}
