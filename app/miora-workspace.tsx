import {mioraPages, type Factory} from './miora-shell';

type Summary = {orders: number; workers: number; parts: number; allocations: number; lastRun: string};
type LoadDay = {date: string; work: number; capacity: number};
type Issue = {key: string; orderNo?: string; partCode: string; name: string; reason: string};
type GuideStep = {tab: string; title: string; body: string; tip: string};

export function MioraDashboard({factory, summaries, metrics, load, issues, shortage, status, onNavigate, onIssues}: {
  factory: Factory; summaries?: Record<Factory, Summary>;
  metrics: {pending: number; work: number; late: number; workers: number; parts: number; lastRun: string; allocations: number};
  load: LoadDay[]; issues: Issue[]; shortage: {count: number; work: number}; status: string;
  onNavigate: (page: string) => void; onIssues: () => void;
}) {
  const maxLoad = Math.max(1, ...load.map(day => Math.max(day.work, day.capacity)));
  return <>
    <section className="cards miora-dashboard-metrics" aria-label="当前工厂生产指标">
      {[
        ['待排车工订单', metrics.pending, 'MES 同步、Excel 导入与手工录入'],
        ['剩余标准工作量', metrics.work.toFixed(1), '剩余数量 × 单件工时值'],
        ['预计延期', metrics.late, '已排计划中的延期订单'],
        ['已启用人员', metrics.workers, '当前工厂'],
        ['工件资料', metrics.parts, '已维护的工件与定额'],
      ].map(([label, value, note]) => <div className={`metric ${label === '预计延期' && metrics.late ? 'danger' : ''}`} key={label}><small>{label}</small><strong>{value}</strong><span>{note}</span></div>)}
    </section>
    {summaries && <section className="panel">
      <div className="panel-title"><div><small>总负责人视图</small><h3>两厂概况对比</h3></div><small>切换入口在本页顶栏</small></div>
      <div className="miora-factory-comparison">
        {(['xian', 'xingping'] as const).map(key => <article key={key}>
          <div className="panel-title"><strong>{key === 'xian' ? '西安工厂' : '兴平工厂'}</strong>{key === factory && <span className="ok">当前工厂</span>}</div>
          <dl>{([
            ['待处理订单', summaries[key].orders], ['人员', summaries[key].workers],
            ['工件', summaries[key].parts], ['派工记录', summaries[key].allocations],
          ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        </article>)}
      </div>
    </section>}
    <div className="miora-board-grid">
      <section className="panel">
        <div className="panel-title"><div><small>标准工作量 · 按工作日</small><h3>六日负荷与产能缺口</h3></div><button type="button" className="import" onClick={() => onNavigate('排产结果')}>查看排产结果</button></div>
        <div className="miora-load" aria-label="六日负荷">
          {load.map(day => <div className="miora-load-row" key={day.date}><time dateTime={day.date}>{day.date.slice(5)}</time><div className="miora-load-track"><span style={{width: `${day.capacity / maxLoad * 100}%`}}/><b style={{width: `${day.work / maxLoad * 100}%`}}/></div><code>{day.work.toFixed(1)} / {day.capacity.toFixed(1)}</code></div>)}
        </div>
        <p className="compact-note">已安排工作量 / 标准产能。未排 {shortage.count} 项，缺口工作量 {shortage.work.toFixed(1)}。</p>
      </section>
      <section className="panel">
        <div className="panel-title"><div><small>当前执行版本</small><h3>最近一次排产</h3></div><span className={status === '已发布' || status === '已确认' ? 'ok' : 'pending'}>{status}</span></div>
        <p>{metrics.lastRun || '尚未运行排产'}</p><p className="compact-note">{metrics.allocations} 条派工记录</p>
        <button type="button" className="import" onClick={() => onNavigate('历史记录')}>查看历史</button>
      </section>
    </div>
    <section className="panel">
      <div className="panel-title"><div><small>进入排产前补齐资料</small><h3>资料待确认</h3></div>{issues.length > 0 && <button type="button" className="import" onClick={onIssues}>核对 {issues.length} 项</button>}</div>
      {issues.length ? <div className="table-wrap"><table><thead><tr><th>订单号</th><th>物料</th><th>工件</th><th>待确认原因</th></tr></thead>
        <tbody>{issues.slice(0, 5).map(issue => <tr key={issue.key}><td className="mono">{issue.orderNo||'—'}</td><td className="mono">{issue.partCode}</td><td>{issue.name}</td><td>{issue.reason}</td></tr>)}</tbody></table></div>
        : <div className="empty">当前没有待确认资料。</div>}
    </section>
  </>;
}

export function MioraProductMap({onNavigate}: {onNavigate: (page: string) => void}) {
  return <section className="panel">
    <div className="panel-title"><div><small>当前功能范围</small><h3>模块总表</h3></div><span className="ok">车工排产</span></div>
    <p className="compact-note">支持 MES 自动同步和 Excel 导入。模块权限与数据范围由登录账号决定。</p>
    <div className="table-wrap"><table>
      <thead><tr><th>编号</th><th>模块</th><th>主要用途</th><th>状态</th></tr></thead>
      <tbody>{mioraPages.map(item => <tr key={item.key}><td className="mono">{item.code}</td><td><button type="button" className="miora-link" onClick={() => onNavigate(item.key)}>{item.title}</button></td><td>{item.detail}</td><td><span className="ok">现有功能</span></td></tr>)}</tbody>
    </table></div>
  </section>;
}

export function MioraGuide({steps, onStart, onNavigate}: {steps: readonly GuideStep[]; onStart: () => void; onNavigate: (page: string) => void}) {
  return <section className="panel">
    <div className="panel-title"><div><small>序衡 APS 上手说明</small><h3>六步主链路</h3></div><button type="button" className="primary" onClick={onStart}>开始交互引导</button></div>
    <ol className="miora-guide-list">{steps.map((step, i) => <li key={step.tab}><span className="mono">{String(i + 1).padStart(2, '0')}</span><div><h3>{step.title}</h3><p>{step.body}</p><small>{step.tip}</small></div><button type="button" className="import" onClick={() => onNavigate(step.tab)}>打开{step.tab}</button></li>)}</ol>
  </section>;
}
