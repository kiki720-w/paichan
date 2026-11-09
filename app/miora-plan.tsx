import type {ReactNode} from 'react';

type Dispatch = {
  date: string; worker: string; orderNo: string; partCode: string; name: string;
  amount: number; capacity: number; due: string; status: string; drawingNo?: string;
  reason?: string; candidates?: string[];
};
type Shortage = {
  orderId?: string; orderNo: string; partCode: string; name: string; due: string;
  requiredWork: number; scheduledWork: number; remainingWork: number; remainingQty: number;
  reason: string; drawingNo?: string; suggestedWorker?: string; estimatedFinish?: string;
};
type Issue = {key: string; orderNo?: string; partCode: string; name: string; reason: string};
type Snapshot = {id: string; createdAt: string; status?: string; publishedAt?: string; withdrawnAt?: string};

export function currentPlanSnapshot<T extends Snapshot>({planStatus, planSnapshotId, planUpdatedAt, history}: {
  planStatus?: string; planSnapshotId?: string; planUpdatedAt?: string; history?: T[];
}): T | undefined {
  if (!history?.length || !['已确认', '已发布', '已撤回'].includes(planStatus ?? '')) return;
  const candidates = history.filter(row => (row.status ?? '已确认') === planStatus);
  if (planSnapshotId) return candidates.find(row => row.id === planSnapshotId);
  if (!planUpdatedAt) return;
  const legacy = candidates.filter(row => (planStatus === '已发布' ? row.publishedAt : planStatus === '已撤回' ? row.withdrawnAt : row.createdAt) === planUpdatedAt);
  return legacy.length === 1 ? legacy[0] : undefined;
}
type PlanProps<T extends Dispatch> = {
  rows: T[]; dates: string[]; view: 'week' | 'day'; day: string; status: string;
  shortages: Shortage[]; issues: Issue[]; updated?: string; changeNote?: string;
  onView: (view: 'week' | 'day') => void; onDay: (day: string) => void; onIssues: () => void;
  onExportDay: (day: string) => void;
  onEdit?: (row: T) => void; onAssign?: (row: T) => void; onComplete?: (row: T) => void;
  progress?: (row: T) => ReactNode;
};

function PlanTask<T extends Dispatch>({row, onEdit, onAssign, onComplete, progress}: {
  row: T; onEdit?: (row: T) => void; onAssign?: (row: T) => void;
  onComplete?: (row: T) => void; progress?: (row: T) => ReactNode;
}) {
  return <details className={`miora-task ${row.status === '延期' ? 'miora-task-late' : ''}`}>
    <summary>
      <strong className="mono">{row.orderNo}</strong>
      <span>{row.name}</span>
      <span className="mono">{row.amount.toFixed(1)} · {row.status}</span>
    </summary>
    <div className="miora-task-detail">
      <small>{row.partCode} · {row.drawingNo || '未提供图号'}</small>
      <small>交期 {row.due || '待补充'} · {progress?.(row)}</small>
      {row.reason && <small>{row.reason}</small>}
      {!!row.candidates?.length && <small>候选：{row.candidates.join('、')}</small>}
      <div className="schedule-actions">
        {onEdit && <button type="button" className="import" onClick={() => onEdit(row)}>人工调整</button>}
        {onAssign && <button type="button" className="import" onClick={() => onAssign(row)}>整单转派</button>}
        {onComplete && <button type="button" className="import" onClick={() => onComplete(row)}>登记完工</button>}
      </div>
    </div>
  </details>;
}

export function MioraPlan<T extends Dispatch>({rows, dates, view, day, status, shortages, issues, updated, changeNote, onView, onDay, onIssues, onExportDay, onEdit, onAssign, onComplete, progress}: PlanProps<T>) {
  const grouped = new Map<string, Map<string, T[]>>();
  const orders = new Set<string>(), late = new Set<string>();
  for (const row of rows) {
    const person = grouped.get(row.worker) ?? new Map<string, T[]>();
    const dayRows = person.get(row.date) ?? [];
    dayRows.push(row);
    person.set(row.date, dayRows);
    grouped.set(row.worker, person);
    const key = row.orderNo + '|' + row.partCode;
    orders.add(key);
    if (row.status === '延期') late.add(key);
  }
  const currentDay = dates.includes(day) ? day : dates[0];
  const hasDailyRows = rows.some(row => row.date === currentDay);
  const missingWork = shortages.reduce((total, item) => total + item.remainingWork, 0);
  const renderTasks = (items: T[]) => items.map((row, index) => <PlanTask key={`${row.orderNo}-${row.partCode}-${index}`} row={row} onEdit={onEdit} onAssign={onAssign} onComplete={onComplete} progress={progress}/>);
  return <div className="miora-plan compact-page">
    <section className="miora-plan-band" aria-label="计划状态">
      <div><small>计划状态</small><span className={status === '已撤回' ? 'late' : status === '已发布' || status === '已确认' ? 'ok' : 'pending'}>{status}</span></div>
      <div><small>已安排订单</small><strong>{orders.size}</strong></div>
      <div><small>预计延期</small><strong>{late.size}</strong></div>
      <div><small>未排工作量</small><strong>{missingWork.toFixed(1)}</strong></div>
      <div><small>资料待确认</small><strong>{issues.length}</strong></div>
    </section>
    {(updated || changeNote) && <p className="compact-note">{[updated, changeNote].filter(Boolean).join(' · ')}</p>}
    <section className="panel">
      <div className="panel-title"><div><small>六工作日 · 按人员分配</small><h3>{view === 'week' ? '车工周计划' : '每日派工'}</h3></div>
        <div className="miora-switch" role="group" aria-label="排产视图">
          <button type="button" aria-pressed={view === 'week'} onClick={() => onView('week')}>周计划</button>
          <button type="button" aria-pressed={view === 'day'} onClick={() => onView('day')}>每日派工</button>
        </div>
      </div>
      {view === 'day' && <div className="panel-title">
        <div className="order-filter-chips" aria-label="派工日期">{dates.map(date => <button key={date} type="button" aria-pressed={date === currentDay} onClick={() => onDay(date)}>{date}</button>)}</div>
        <button type="button" className="import" disabled={!hasDailyRows} onClick={() => onExportDay(currentDay)}>导出当日派工单</button>
      </div>}
      {!rows.length ? <div className="empty"><b>尚未生成派工</b><span>生成计划后在这里查看；未排任务请核对下方缺口与资料。</span></div>
      : view === 'week' ? <div className="table-wrap miora-matrix" role="region" aria-label="人员与日期排产矩阵" tabIndex={0}>
        <table><thead><tr><th scope="col">人员</th>{dates.map(date => <th key={date} scope="col" title={date}>{date.slice(5)}</th>)}</tr></thead>
          <tbody>{[...grouped].map(([worker, byDate]) => <tr key={worker}><th scope="row">{worker}</th>{dates.map(date => <td key={date}>{byDate.has(date) ? renderTasks(byDate.get(date)!) : <small>—</small>}</td>)}</tr>)}</tbody>
        </table>
      </div> : <div className="table-wrap"><table>
        <thead><tr><th>人员</th><th>当日派工</th><th>工作量 / 日产能</th></tr></thead>
        <tbody>{[...grouped].flatMap(([worker, byDate]) => {
          const tasks = byDate.get(currentDay);
          if (!tasks?.length) return [];
          return [<tr key={worker}><th scope="row">{worker}</th><td><div className="miora-daily-tasks">{renderTasks(tasks)}</div></td><td className="mono">{tasks.reduce((n, row) => n + row.amount, 0).toFixed(1)} / {tasks[0].capacity.toFixed(1)}</td></tr>];
        })}</tbody>
      </table>{!hasDailyRows && <div className="empty">该工作日没有派工。</div>}</div>}
    </section>
    <section className="panel" aria-label="产能缺口清单">
      <div className="panel-title"><div><small>六天内未排完的工作</small><h3>产能缺口清单</h3></div><span className={shortages.length ? 'late' : 'ok'}>{shortages.length} 项</span></div>
      {shortages.length ? <div className="table-wrap"><table>
        <thead><tr><th>订单 / 工件</th><th>交期</th><th>未排工作量</th><th>缺口数量</th><th>建议 / 预计</th><th>原因</th></tr></thead>
        <tbody>{shortages.map(item => <tr key={item.orderId ?? item.orderNo + '|' + item.partCode}>
          <td><b className="mono">{item.orderNo}</b><small className="cell-note">{item.name} · {item.partCode} · {item.drawingNo || '未提供图号'}</small></td>
          <td>{item.due || '待补充'}</td><td><b className="late">{item.remainingWork.toFixed(1)}</b><small className="cell-note">应排 {item.requiredWork.toFixed(1)} · 已排 {item.scheduledWork.toFixed(1)}</small></td>
          <td className="mono">{item.remainingQty.toFixed(2)}</td><td>{item.suggestedWorker || '待匹配'}<small className="cell-note">{item.estimatedFinish || '无法估算'}</small></td><td>{item.reason}</td>
        </tr>)}</tbody>
      </table></div> : <div className="empty">{rows.length ? '当前计划没有记录产能缺口。' : '尚无产能缺口记录。'}</div>}
    </section>
    {issues.length > 0 && <section className="panel">
      <div className="panel-title"><h3>资料不全未排入</h3><button type="button" className="import" onClick={onIssues}>前往订单补充</button></div>
      <div className="table-wrap capped-table"><table><thead><tr><th>订单号</th><th>物料</th><th>工件</th><th>未排原因</th></tr></thead>
        <tbody>{issues.map(issue => <tr key={issue.key}><td className="mono">{issue.orderNo||'—'}</td><td className="mono">{issue.partCode}</td><td>{issue.name}</td><td>{issue.reason}</td></tr>)}</tbody>
      </table></div>
    </section>}
  </div>;
}
