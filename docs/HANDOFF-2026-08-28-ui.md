# 人员表格滚动与订单搜索接力（2026-08-28）

## 本次需求与完成内容

- 人员产能表、周计划和每日派工明细增加独立横向滚动区域、左右翻动按钮、键盘聚焦入口；修正嵌套网格最小宽度，避免宽表被卡片裁切。
- 订单管理增加表格滚动区域。搜索栏保留原有检索逻辑，改为紧凑标签、搜索图标、清除按钮和匹配数量。清除后恢复输入焦点。
- 保留接力前已经存在的姓名旁“更换员工”按钮、订单人工指定逻辑和其他未提交修改。
- 未修改排产算法、生产数据、账号配置或线上服务器。

## 验证

- vinext build 成功。
- tests/feedback-0827.test.mjs 与 tests/feedback-0828.test.mjs 共 26 项通过；包括左右按钮滚动方向、减少动态效果偏好、搜索计数与清除焦点，以及原有分配规则。
- 完整测试另有两个旧模板测试失败：Node 无法直接加载 cloudflare:workers，且测试引用的 app/_sites-preview/SkeletonPreview.tsx 不存在。本次未修改该测试文件。
- tsc --noEmit 报错位于未修改的 Cloudflare 类型声明和 auth/passwords.ts BufferSource 类型；未通过全项目类型检查。
- 本地页面 HTTP 返回 200，已请求在 Codex 打开预览；未做浏览器视觉或触屏实测。

## 发布状态

用户确认“同步”后，已核对域名指向腾讯云 152.136.104.219，实际运行目录为 /opt/paichan，服务为 xuheng-aps.service；未发布到旧 Sites 环境。

已更新线上 app/scheduler-app.tsx 和 app/globals.css，更新前后均校验 SHA-256。服务器备份目录为 /opt/paichan-backups/ui-scroll-search-20260828-200335。服务重启后状态 active，公开地址 https://xuheng-aps.com/ 及对应脚本、样式返回 HTTP 200；响应包含新滚动与搜索实现。未做登录后的浏览器实测。本记录与界面源码、相关测试一起同步到 GitHub。

工作区还有接力前的 vite.config.ts 和 dev.out.log 等修改，以及多个旧部署归档；不要整体暂存或覆盖这些文件。
