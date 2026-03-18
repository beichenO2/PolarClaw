# Decisions Log (Append-only)

Rules:
- Append new entries only. Do not rewrite old entries.
- Each decision should be small, explicit, and reversible where possible.

---

## Inherited from Legacy Project (2026-03-04)

- D001: Single-machine deployment only (reduce complexity)
- D002: Vertical slices with acceptance tests at each slice
- D003: WebUI is the entry point; chat is the first feature
- D004: Contract-first: interfaces.md defines API shape; code must follow
- D005: Frontend → Vite + React
- D006: Backend → FastAPI + uvicorn
- D007: CORS allow-origin: http://localhost:3000 only
- D008: LLMProvider interface: generate(message, params) -> str; EchoProvider for stub
- D009: POST /chat error: normalized {"error":{"code":"...","message":"..."}} with HTTP 500

---

## 2026-03-18 (CLAW Baseline v0.1)

- D010: Introduce SSOT/ directory as canonical project fact source (replacing docs/)
- D011: Introduce Sprompt/ as prompt/spec source code library (static specs, not runtime)
- D012: Runtime objects stored as JSON files under runtime/tasks/{task_id}/
- D013: PromptAssembler reads from Sprompt/prompts/roles/ and compiles context-injected prompt packs
- D014: ModelGateway abstraction with two concrete providers: QwenProvider (DashScope-compatible OpenAI API), EchoProvider (stub)
- D015: AliCompatProvider is a skeleton only (Ali_API_KEY missing); wired but not functional
- D016: Qwen API accessed via OpenAI-compatible endpoint (DashScope), model=qwen-plus
- D017: ValidatorEngine baseline: checks required fields, whitelist presence, result format — not full deterministic evidence-based validation (full spec in Sprompt/operational/03_validator_spec.md, phased in later)
- D018: Files that are no longer active must be moved to /Users/mac/Desktop/ClawBin — never deleted
- D019: GitHub sync is a required engineering habit: commit frequently, push at milestones
- D020: Web UI redesigned as CLAW Console (not a simple chat page)
- D021: Backend module structure: api/, orchestrator/, prompt_runtime/, runtime_store/, model_gateway/, validator/, ssot_reader/
- D022: ModelProvider interface upgraded to messages-list format (OpenAI-compatible) from single-string format
D022: Qwen_Pro_API_KEY (len=38) causes 401 on DashScope - likely wrong format or needs DASHSCOPE_API_KEY env var name. System auto-falls back to EchoProvider. Key needs reconfiguration.

---

## 2026-03-18 (Router baseline v0.1)

- D023: 引入 Router 层（Layer 1.5），位于 CLAW/Orchestrator 与 Executor 之间。Router 负责 WorkItem 拆分和 RouteGroup 组装。
- D024: Router baseline v0.1 采用规则驱动保守拆分策略：序号列表 / bullet / 分隔词触发多 WorkItem，否则保守为 1 WorkItem + warning。
- D025: RouteGroup 默认 1 WorkItem → 1 RouteGroup（保守隔离）。mode 相同 + 无 isolation/dependency/conflict 时允许合并。
- D026: RouteGroup 执行策略：Router baseline v0.1 串行处理所有 RouteGroup；数据结构已支持未来并行（run_ids 为列表，RouteGroupRuntime 独立存储）。
- D027: Bot 分配规则（baseline）：project_mode → ProjectMakerBot；knowledge_mode → KnowleverBot；FSM 字段预留为 null。
- D028: editable_whitelist 未知时必须写 ["TBD"]，不得伪装成已知值，必须在 RouterDecision.warnings 中记录。
- D029: validate_router() 独立于 validate()，Router 验证结果以 router_validation 字段注入 validation_report，不覆盖主判定。
- D030: Router 产物有 warnings 无 violations → PARTIAL（可接受，需记录）；有 violations → FAIL。
- D031: Wait Gate 字段（wait_gate_event / blocked_task_state / human_confirmation_required / interface_change_proposal）在 Router baseline v0.1 中已定义并预留，但不激活实际阻塞逻辑。
- D032: API 环境变量命名规范：PolarClaw_DASHSCOPE_API_KEY 为本项目使用的 DashScope API key；Coding_Plan_API_KEY 为阿里 Coding Plan 提供的供 Claw（OpenClaw 架构 AI 助手统称）使用的 LLM API。
- D033: CodingPlanProvider 作为所有 agent 对话主力 provider。endpoint=https://coding-intl.dashscope.aliyuncs.com/v1，model=qwen3.5-plus。原 QwenProvider (DashScope) 降级为 fallback。
- D034: MiniMaxProvider 引入，用于视觉任务（MiniMax-M2.7 支持 vision input）和多模型 debug 场景（A 模型输出让 B 模型 review，互补提升可靠性）。key=Minimax_Token_Plan_API_KEY。
- D035: 引入 get_provider_for_task(task_type) 接口，task_type ∈ {agent, vision, debug, general}。不同 task_type 走不同 provider 优先链。
- D036: 多模型 debug 原则：task_type=debug 时优先用 MiniMax（与 qwen/CodingPlan 来自不同厂商），提供独立视角，避免同模型族的系统性盲点。
- D037: nanoClaw 设计哲学对齐：no config sprawl，env-var driven，minimal branching，provider 选择逻辑清晰可读。

## 2026-03-18 (Model Selection Benchmark & Task-Type Routing)

- D038: 对 Coding Plan 所有可用模型进行延迟基准测试（2026-03-18），结果如下：
  - qwen3-coder-plus  ~1.8s  ✓ 最快 + coding 专优
  - kimi-k2.5         ~2.4s  ✓ 结构化 JSON 输出最佳，适合 Router/Agent
  - qwen-plus (DS)    ~2.9s  ✓ 通用 fallback，干净简洁
  - MiniMax-M2.7      ~5.6s  ✓ CoT 推理，视觉支持
  - MiniMax-M2.5(CP)  ~9.2s  备选
  - qwen3.5-plus      ~13s   × 已降级，不再作为默认
  - qwen3-coder-next  ~16s   × 比 qwen3-coder-plus 慢
  - glm-5             ~33s   × 不推荐交互使用

- D039: 引入 task_type → model 精细映射，替代 "所有 agent 任务统一走同一模型" 策略：
  - coding  → CP / qwen3-coder-plus  （~1.8s，project_mode 代码编辑/生成专用）
  - router  → CP / kimi-k2.5         （~2.4s，WorkItem 拆分/RouteGroup 组装，JSON 输出最佳）
  - agent   → CP / kimi-k2.5         （~2.4s，通用 agent 推理与指令执行）
  - vision  → MM / MiniMax-M2.7      （~5.6s，多模态输入）
  - debug   → MM / MiniMax-M2.7      （~5.6s，跨厂商 B 模型 review，独立推理避免系统性盲点）
  - general → DS / qwen-plus         （~2.9s，报告生成/汇总/通用 fallback）

- D040: Orchestrator mode → task_type 映射规则：
  - project_mode   → "coding"   → qwen3-coder-plus
  - knowledge_mode → "agent"    → kimi-k2.5
  - debug_mode     → "debug"    → MiniMax-M2.7
  - vision_mode    → "vision"   → MiniMax-M2.7
  - 其他/未知       → "agent"    → kimi-k2.5

- D041: get_provider_for_task() 使用 functools.partial 绑定 model 参数，使同一 CodingPlanProvider 类可按 task_type 实例化不同模型，而不引入多个子类。
- D042: Minimax_Token_Plan_API_KEY 已确认配置正确（MiniMax provider 可用）；此前显示 "未配置" 是因为未 source ~/.bashrc，运行时已解决。

## 2026-03-18 (反悔/Regret 功能)

- D043: 引入"反悔"（Regret/Undo）功能，包含三个操作：Pause / Supplement / Revise。
  - Pause：将 processing 任务标记为 paused，在下一个 RouteGroup 启动前生效（不中断当前 RG 执行）
  - Supplement：向 paused 任务追加额外描述，Router 对增量重新路由，合并新 WorkItem 后恢复执行
  - Revise：编辑原始 goal，系统标记原任务为 superseded，尝试 git revert 编辑过的文件，创建新任务
- D044: git_checkpoint 存储在 task_contract 中（创建时 git rev-parse HEAD），作为 revise 时的 revert 基准点。
- D045: git revert 策略：从 WorkItem.editable_whitelist 和 evidence_pack.actions 收集实际修改过的文件列表，使用 git checkout {checkpoint} -- {file} 逐文件恢复。revert 失败不阻断新任务创建，记录到 revert_result。
- D046: Revise 时原任务状态设为 superseded，新任务继承 session_id 和 git_checkpoint，并记录 revised_from_task_id 用于追溯。
- D047: 前端 UI：processing 状态显示 ⏸ Pause 按钮；paused 状态显示 ＋ Supplement 和 ↺ Revise 两个入口；Revise 模式下原始 goal 变为可编辑 textarea。
