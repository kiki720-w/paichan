import type {FormEvent, ReactNode} from 'react';

export type Factory = 'xian' | 'xingping';
type Role = 'main' | 'factory';

export const mioraSections = [
  {title: '排产主流程', items: [
    {key: '看板', title: '生产看板', code: 'DSH', detail: '六个工作日的生产概况与异常'},
    {key: '数据导入', title: '数据导入', code: 'IMP', detail: '导入 MES Excel 并核对识别结果'},
    {key: '订单管理', title: '订单管理', code: 'ORD', detail: '订单核对、指定人员与完工登记'},
    {key: '生产审批', title: '生产审批', code: 'APR', detail: '紧急插单、临时外协申请和审批结果'},
    {key: '排产结果', title: '排产结果', code: 'SCH', detail: '周计划、每日派工与计划发布'},
  ]},
  {title: '生产监控', items: [
    {key: '工序任务', title: '工序任务', code: 'OPT', detail: '工单、工序和报工进度'},
    {key: '预警中心', title: '预警中心', code: 'ALR', detail: '进度核对、工序预警与异常跟踪'},
    {key: '情景试算', title: '情景试算', code: 'SIM', detail: '比较插单、请假或交期变化对计划的影响'},
  ]},
  {title: '能力与记录', items: [
    {key: '人员产能', title: '人员产能', code: 'CAP', detail: '班组人员、日产能和技能'},
    {key: '工件定额', title: '工件定额', code: 'QTA', detail: '物料、工时和可加工人员'},
    {key: '业务规则', title: '业务规则', code: 'RUL', detail: '车工排产约束和工时分档'},
    {key: '历史记录', title: '历史记录', code: 'HIS', detail: '计划快照与操作追溯'},
    {key: '使用引导', title: '使用引导', code: 'GUD', detail: '从导入生产数据到发布计划的六步指引'},
  ]},
] as const;

export const mioraPages = mioraSections.flatMap(group => [...group.items]);
const factoryNames = {xian: '西安工厂', xingping: '兴平工厂'} as const;

type ShellProps = {
  page: string;
  role: Role;
  factory: Factory;
  account: string;
  onNavigate: (page: string) => void;
  onSwitchFactory: (factory: Factory) => void;
  onPassword: () => void;
  onLogout: () => void;
  actions?: ReactNode;
  children: ReactNode;
};

export function MioraShell({page, role, factory, account, onNavigate, onSwitchFactory, onPassword, onLogout, actions, children}: ShellProps) {
  const active = mioraPages.find(item => item.key === page);
  return <div className="miora-shell">
    <aside className="miora-sidebar" aria-label="序衡工作区">
      <div className="miora-brand"><span>序衡</span><small>APS</small><code>{factory === 'xian' ? 'XA' : 'XP'}</code></div>
      <div className="miora-factory"><i aria-hidden="true"/><div><small>当前工厂</small><strong>{factoryNames[factory]}</strong></div></div>
      <nav className="miora-nav" aria-label="业务模块">
        {mioraSections.map(group => <div key={group.title} className="miora-nav-group">
          <h2>{group.title}</h2>
          {group.items.map(item => <button type="button" key={item.key} aria-current={item.key === page ? 'page' : undefined} onClick={() => onNavigate(item.key)}>
            <span className="miora-nav-index">{String(mioraPages.indexOf(item) + 1).padStart(2, '0')}</span>
            <span>{item.title}</span><code>{item.code}</code>
          </button>)}
        </div>)}
        <button type="button" className="miora-map-link" aria-current={page === '产品地图' ? 'page' : undefined} onClick={() => onNavigate('产品地图')}><span>产品地图</span><code>MAP</code></button>
      </nav>
      <div className="miora-account">
        <div><strong>{account}</strong><small>{role === 'main' ? '总负责人' : '工厂负责人 · 仅本厂'}</small></div>
        <div><button type="button" onClick={onPassword}>修改密码</button><button type="button" onClick={onLogout}>退出登录</button></div>
      </div>
    </aside>
    <main className="miora-main">
      <header className="miora-header">
        <div className="miora-title">
          <span className="miora-kicker">{active?.code ?? 'APS'} <span aria-hidden="true">/</span> {factoryNames[factory]} <span aria-hidden="true">/</span> 车工</span>
          <h1>{active?.title ?? page}</h1>
          {active && <p>{active.detail}</p>}
        </div>
        <div className="miora-actions">
          {role === 'main' && page === '看板' && <div className="miora-switch" aria-label="切换工厂" role="group">
            <button type="button" aria-pressed={factory === 'xian'} onClick={() => onSwitchFactory('xian')}>西安工厂</button>
            <button type="button" aria-pressed={factory === 'xingping'} onClick={() => onSwitchFactory('xingping')}>兴平工厂</button>
          </div>}
          {actions}
        </div>
      </header>
      <div className="miora-content">{children}</div>
    </main>
  </div>;
}

export function MioraLogin({username, password, error, onUsername, onPassword, onSubmit}: {
  username: string;
  password: string;
  error: string;
  onUsername: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <main className="miora-login">
    <section className="miora-login-intro" aria-labelledby="miora-intro-title">
      <div className="miora-brand"><span>序衡</span><small>APS</small></div>
      <span className="miora-kicker">生产计划中心 / 车工</span>
      <h1 id="miora-intro-title">把六个工作日的车工产能，<br/>排到每一道工序上。</h1>
      <p>从 MES Excel 导入，到核对订单、生成排产和发布派工。西安与兴平的人员、工件和计划分别维护。</p>
      <div className="miora-login-steps"><span>01 导入与核对</span><span>02 车工排产</span><span>03 确认与发布</span></div>
      <small className="miora-login-foot">序衡 APS　·　六工作日滚动排产</small>
    </section>
    <section className="miora-login-access" aria-labelledby="miora-login-title">
      <div className="miora-login-box">
        <span className="miora-kicker">账号与工厂权限</span>
        <h2 id="miora-login-title">账号登录</h2>
        <p>使用已分配的序衡账号，系统会识别你的工厂权限。</p>
        <form onSubmit={onSubmit}>
          <label>账号<input name="username" autoComplete="username" value={username} onChange={event => onUsername(event.target.value)} required/></label>
          <label>密码<input name="password" type="password" autoComplete="current-password" value={password} onChange={event => onPassword(event.target.value)} required/></label>
          {error && <p className="miora-error" role="alert">{error}</p>}
          <button className="primary" type="submit">登录系统</button>
        </form>
        <small>总负责人可在生产看板切换工厂；工厂负责人只访问所属工厂。</small>
      </div>
    </section>
  </main>;
}
