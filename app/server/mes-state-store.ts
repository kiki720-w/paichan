import type {MesFactory, MesSyncState, MesSyncStore} from './mes-source';

type BoundStatement={first<T>():Promise<T|null>};
type Db={
 prepare(sql:string):{bind(...params:(string|number)[]):BoundStatement};
 batch(statements:BoundStatement[]):Promise<{meta:{changes:number}}[]>;
};

/** Uses the existing APS state, backup and audit tables; never accesses the MES database. */
export function createMesStateStore<S extends MesSyncState>(db:Db,initial:(factory:MesFactory)=>S):MesSyncStore<S>{
 return {
  async read(factory){
   const row=await db.prepare('SELECT data,revision FROM factory_state WHERE factory=?').bind(factory).first<{data:string;revision:number}>();
   return row?{state:JSON.parse(row.data) as S,revision:row.revision}:{state:initial(factory),revision:0};
  },
  async commit(factory,expected,state){
   const id=crypto.randomUUID(),now=new Date().toISOString(),next=expected+1;
   const actor='MES 只读同步',action='同步 MES 工单';
   // The conditional audit row is the transaction marker. No stale revision
   // can insert it, so neither the backup nor the state can change in that case.
   const [, , write]=await db.batch([
    db.prepare(`INSERT INTO factory_audit(id,factory,actor,action,summary,revision,created_at)
     SELECT ?,?,?,?,?,?,?
     WHERE (?=0 AND NOT EXISTS(SELECT 1 FROM factory_state WHERE factory=?))
        OR EXISTS(SELECT 1 FROM factory_state WHERE factory=? AND revision=?)`)
     .bind(id,factory,actor,action,'只读来源工单与同步游标已保存',next,now,expected,factory,factory,expected),
    db.prepare(`INSERT INTO factory_state_backup(id,factory,data,revision,actor,action,created_at)
     SELECT ?,factory,data,revision,?,?,? FROM factory_state
     WHERE factory=? AND revision=? AND EXISTS(SELECT 1 FROM factory_audit WHERE id=?)`)
     .bind(crypto.randomUUID(),actor,action,now,factory,expected,id),
    db.prepare(`INSERT INTO factory_state(factory,data,revision,updated_at)
     SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM factory_audit WHERE id=?)
     ON CONFLICT(factory) DO UPDATE SET data=excluded.data,revision=excluded.revision,updated_at=excluded.updated_at
     WHERE factory_state.revision=?`)
     .bind(factory,JSON.stringify(state),next,now,id,expected),
   ]);
   return write.meta.changes===1;
  },
 };
}
