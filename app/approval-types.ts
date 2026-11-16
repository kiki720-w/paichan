export type ApprovalKind='urgent'|'outsourcing';
export type ApprovalStatus='pending'|'approved'|'rejected';
export type ApprovalRequest={
 id:string;kind:ApprovalKind;status:ApprovalStatus;orderNo:string;partCode:string;quantity:number;
 due:string;reason:string;submittedBy:string;submittedAt:string;
 decidedBy:string|null;decidedAt:string|null;decisionNote:string|null;
 executedBy?:string|null;executedAt?:string|null;executedOrderNo?:string|null;
};
export const approvalKinds={urgent:'紧急插单',outsourcing:'临时外协'} as const;
export const approvalStatuses={pending:'待审批',approved:'已通过',rejected:'已驳回'} as const;
