export type ExceptionStage='待处理'|'分析中'|'待确认'|'已解决'|'已忽略';
export type DispatchExceptionEvent={
 id:string;key:string;orderNo:string;partCode:string;operation?:string;version:string;
 stage:ExceptionStage;reason:string;actor:string;at:string;sequence:number;
};

const transitions:Record<ExceptionStage,ExceptionStage[]>={
 '待处理':['分析中','已忽略'],
 '分析中':['待确认','已解决','已忽略'],
 '待确认':['分析中','已解决','已忽略'],
 '已解决':[],
 '已忽略':[],
};

export function exceptionNextStages(stage:ExceptionStage){
 return transitions[stage];
}

export function validateExceptionTransition(stage:ExceptionStage,next:ExceptionStage,reason:string){
 if(!exceptionNextStages(stage)?.includes(next))throw Error('该异常当前不可执行此操作，请刷新后重试。');
 if((next==='已解决'||next==='已忽略')&&!reason.trim())throw Error('请填写解决或忽略的原因。');
 if(reason.length>500)throw Error('原因最多 500 字。');
}
