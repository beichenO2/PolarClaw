# gsd-2 修复交接 — 2026-04-10

## 本轮完成的工作

### P0 修复（关键）

1. **launcher 指数退避** (`launch-cluster.sh`)
   - 替换固定 5s 重启为指数退避：5s → 10s → 20s → ... → 最大 300s
   - 正常退出(runtime > 2min)重置退避为 5s
   - 快速退出(runtime < 2min)退避翻倍
   - 60s 内超过 10 次重启 → 强制休眠 5 分钟
   - 每次重启写入 `.planning/agent-state/<agent>.json` 状态文件

2. **Agent 重复创建保护** (`proxy-prompt.template.md`)
   - Stage 3 增加 tmux session 存在性检查
   - 增加 `.planning/agent-state/launched.json` 启动标记
   - 已有 Agent 运行时跳过创建阶段

3. **重启恢复上下文** (`launch-cluster.sh`)
   - 非首次启动时在 prompt 后附加恢复提示
   - 告知 Agent 跳过初始化步骤，直接进入工作循环

### P1 修复

4. **hub-call.sh 超时** 
   - 初始化和工具调用都加 `--connect-timeout 5 --max-time 30`

5. **CLI Agent 循环强化** (所有 prompt 模板)
   - 重写生命周期规则，明确"你是常驻服务不是一次性脚本"
   - 具体的 sleep + 继续 poll 步骤
   - "你的下一个动作永远是调用 Shell 工具"

6. **prompts.ts work loop 更新**
   - 标准工作循环增加 NEVER EXIT 标注
   - 增加 sleep 10 步骤

### P2 改进

7. **备用池(standby)启动** (`launch-cluster.sh`)
   - `launch-cluster.sh` 之前只创建 ctrl + super + workers，没有创建 standby agents
   - 新增自动创建 standby agents（NUM_WORKERS/5，最少2最多10个）
   - 自动分配 reserve 角色，修复 CLK succession "no reserves available" 问题
8. **standbyPrompt 强化** (`prompts.ts`)
   - 增加生命周期规则和标准轮询循环
9. **hub_report_degradation 未实现** (BUG-REPORT Bug 7)
   - CHANGELOG v0.5.0 和 ARCHITECTURE.md 引用了 `hub_report_degradation` 和 `hub_system_resources`
   - 但 http.ts 中未实际实现这两个工具
10. **cluster-status.sh** — 增加 Agent 重启状态面板
11. **controller-prompt.template.md** — 增加任务完成处理流程和错误处理策略
12. **stop-cluster.sh** — 停止时清理 launched.json 启动标记
13. **CHANGELOG.md** — v0.5.1 变更记录
14. **BUG-REPORT.md** — 7 个 bug 详细分析
15. **RESEARCH.md** — 3 个外部项目调研

## 已修改的文件

```
scripts/launch-cluster.sh               — launcher 模板重写(指数退避+恢复上下文)
scripts/hub-call.sh                      — curl 超时
scripts/cluster-status.sh                — agent-state 面板
scripts/run-phase.sh                     — 迁移到项目隔离前缀
scripts/launch-system.sh                 — 标记为已废弃
src/roles/proxy-prompt.template.md       — launcher 模板 + 启动保护
src/roles/controller-prompt.template.md  — 生命周期 + 任务策略 + 错误处理
src/roles/supervisor-prompt.template.md  — 生命周期
src/roles/worker-prompt.template.md      — 生命周期
src/roles/partition-ctrl-prompt.template.md — 生命周期
src/roles/global-clk-prompt.template.md  — 新增：全局时钟模板
src/roles/prompts.ts                     — work loop + globalClkPrompt + standbyPrompt 强化
src/roles/launcher.ts                    — 修复硬编码 gsd2- 前缀
scripts/stop-cluster.sh                  — 清理 launched.json
ARCHITECTURE.md                  — 更新核心原则和工作循环
README.md                        — 更新模板列表和 Agent 生命周期说明
package.json                     — 版本 0.5.1
CHANGELOG.md                     — v0.5.1 记录
.planning/BUG-REPORT.md          — 新增（7个bug）
.planning/RESEARCH.md            — 新增
.planning/HANDOFF.md             — 本文件
```

## 下一步待做

### 高优先级
- [ ] 实际测试：启动一个小型集群验证修复效果
- [ ] 解决 Cursor 账单问题后重新测试 Agent 生命周期
- [ ] 验证恢复上下文（重启后 Agent 是否正确跳过初始化）
- [ ] 验证备用池 succession：手动 kill 一个 ctrl tmux session，确认 CLK 触发 succession + standby 接管
- [ ] 实现 `hub_report_degradation` 和 `hub_system_resources`（ARCHITECTURE 引用但 http.ts 未实现）

### 中优先级
- [ ] 开发 Web 监控面板（从 Hub SQLite 读取实时数据）
- [ ] 改进 controller 智能调度（基于 worker 历史表现）
- [ ] 增加 dry-run 模式模拟 Agent 消息流

### 低优先级
- [ ] 研究 OWL 的动态协调模式
- [ ] 评估 Agent File (.af) 格式用于 checkpoint
- [ ] 测试覆盖率提升

## 注意事项

- 所有 prompt 文件修改对已运行的 Agent 无效（它们已加载旧 prompt）
- `.ts` 文件修改了 prompts.ts 和 launcher.ts，但这些是模板生成函数，不影响已运行的 Hub
- 需要在下次启动集群时才会使用新的 prompt 和 launcher
- 当前 60 个 tmux session 中的 Agent 因账单问题在快速循环——即使不部署这个修复，解决账单后它们会恢复正常工作
