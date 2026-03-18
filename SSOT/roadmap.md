# CLAW Roadmap

---

## Done

- [x] Sprompt/ 规范库建立（v0.1）
- [x] SSOT/ 文档体系建立
- [x] 旧项目代码 docs/ 归档
- [x] Backend skeleton（FastAPI + 模块化结构）
- [x] ModelGateway（QwenProvider + EchoProvider）
- [x] PromptAssembler + ContextPacker
- [x] RuntimeStore（JSON 文件存储）
- [x] ValidatorEngine（baseline skeleton）
- [x] Frontend CLAW Console（Task/Run/Result/Validation 面板）
- [x] 最小闭环联调（Baseline v0.1）
- [x] **Router 层实现（Router baseline v0.1）**
  - [x] WorkItem 拆分（规则驱动，保守策略）
  - [x] RouteGroup 组装（保守合并策略）
  - [x] RouterDecision / RouterReviewResult 对象落地
  - [x] RouteGroupRuntime / RouteGroupResult 对象落地
  - [x] validate_router() Router 层结构验证
  - [x] RuntimeStore 扩展（Router 相关文件）
  - [x] Frontend Router 可视化（WorkItems / RouteGroups / Router Summary 面板）
  - [x] SSOT/interfaces.md 更新（Router 对象契约）
  - [x] Sprompt Router 规范（layered_architecture / router_policy / Router role）
  - [x] 端到端验证通过
- [x] **Multi-provider 架构**（CodingPlanProvider + MiniMaxProvider + QwenProvider）
- [x] **模型基准测试 + Task-type 精细路由**（2026-03-18）
  - [x] qwen3-coder-plus 作为 coding 主力（~1.8s）
  - [x] kimi-k2.5 作为 router/agent 主力（~2.4s）
  - [x] MiniMax-M2.7 作为 vision/debug 主力（~5.6s）
  - [x] qwen3.5-plus 降级（~13s，不再作为默认）
  - [x] Minimax_Token_Plan_API_KEY 确认可用

## Now

- [x] **项目文件结构清理**：root 遗留文件移除，docs/ 归档完成，.gitignore 修复
- [x] **整体联合调试**：21/21 smoke tests pass，backend+frontend 健康
- [x] GitHub 推送（fd27a17，含 Router + multi-provider + benchmark + docs）
- [ ] RouteGroup 串行执行升级为真正独立执行链（目前用 task_contract 代理）
- [ ] WorkItem 拆分关键词扩展（当前仅基础规则）

## Next

- [ ] **Branch 功能**（用户手动分支 + AI 自动拆分 Executor 协作）
  - 手动版：用户触发 branch，两个 Executor 共享前置记忆，workspace 不变，协作提醒 systemPrompt（JSON 格式）
  - 自动版：AI 自动拆解需求，分发给多个 Executor，附带同步感知 systemPrompt
- [ ] FSM 定义（ProjectMainFSM, ValidationFSM）
- [ ] Evidence pack 完整收集（port probe, command execution）
- [ ] 完整 Deterministic Validator（基于 evidence_pack）
- [ ] Human Action Gate 激活（wait_gate_event / human_confirmation_required 真正阻塞）
- [ ] Pattern 库建立（PortProbePattern, APISetupPattern）
- [ ] 每个 RouteGroup 独立 run_id 链（当前串行共享最后一个 run_id）

## Later

- [ ] 向量检索 + pattern retrieval
- [ ] 自进化提案流程
- [ ] Multi-Agent 并发 RouteGroup 调度
- [ ] Knowledge mode 完整实现
- [ ] 完整 FSM 状态图
- [ ] Session 多轮上下文

## Backlog

- [ ] AliCompatProvider 打通（Ali_API_KEY 获取后）
- [ ] Web UI 移动端适配
- [ ] Docker 容器化
