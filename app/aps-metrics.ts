import type {D1Database} from '@cloudflare/workers-types/index.ts';

export type MetricEvent={
 kind:'首次查看'|'方案生成';subject:string;baseVersion:string;actor:string;at:string;
};

export function ensureApsMetrics(db:D1Database){
 return db.prepare(`CREATE TABLE IF NOT EXISTS aps_metric_events (
  factory TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL, base_version TEXT NOT NULL,
  actor TEXT NOT NULL, recorded_at TEXT NOT NULL, PRIMARY KEY(factory,kind,subject,base_version)
 )`).run();
}

export async function recordApsMetric(db:D1Database,factory:string,event:MetricEvent){
 await ensureApsMetrics(db);
 await db.prepare(`INSERT OR IGNORE INTO aps_metric_events(factory,kind,subject,base_version,actor,recorded_at)
  VALUES(?,?,?,?,?,?)`).bind(factory,event.kind,event.subject,event.baseVersion,event.actor,event.at).run();
}
