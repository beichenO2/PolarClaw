# Execution Plan: CLAW Baseline v0.1

**创建时间：** 2026-03-18  
**状态：** IN PROGRESS  
**目标：** 实现 CLAW 系统最小可运行闭环

---

## 现状审查结论

### 保留的内容
| 内容 | 位置 | 说明 |
|------|------|------|
| FastAPI 后端骨架 | `backend/main.py` | 重构为新结构，保留 /health |
| LLM 抽象层思路 | `backend/llm_provider.py` | 升级为 model_gateway，保留 EchoProvider |
| Vite+React 前端 | `frontend/` | 重构 App.jsx 为 CLAW 控制台 |
| Sprompt 规范库 | `Sprompt/` | 不变，接入运行时 |
| 设计文档 | `设计文档/` | 保留作参考 |

### 归档到 ClawBin 的内容
| 文件 | 原因 |
|------|------|
| `docs/` 全部文件 | 迁移到 `SSOT/`，旧路径归档 |
| `prompt` | 被 Sprompt/ 体系替代 |
| `经验.md` | 项目特定历史记录，沉淀已在 Sprompt/migration/ |
| `通用经验.md` | 已迁移到 Sprompt/migration/legacy_asset_mapping.md |

### 新建结构
```
SSOT/           ← 系统/项目事实源（替代 docs/）
runtime/        ← 运行时对象存储（JSON）
backend/
  api/          ← API 路由层
  orchestrator/ ← 任务生命周期管理
  prompt_runtime/ ← PromptAssembler + ContextPacker
  runtime_store/  ← 运行时对象 CRUD
  model_gateway/  ← 统一模型网关
  validator/      ← 验证引擎
  ssot_reader/    ← SSOT 文档读取器
frontend/src/   ← CLAW 控制台 UI（重写 App.jsx）
```

---

## 本轮最小闭环范围

```
用户在 CLAW Console 输入任务
  → POST /api/tasks
  → 规范化 + 创建 task_contract
  → PromptAssembler 装配 compiled prompt
  → ModelGateway 调用模型
  → 保存 agent_result
  → ValidatorEngine 验证
  → 保存 validation_report
  → 前端展示 status + result + validation
```

---

## 明确不做的事（本阶段）

- 不做完整 FSM 状态图
- 不做多 Agent 并发
- 不做向量检索
- 不做完整自进化
- 不做复杂的 session 管理（只用 session_id 字段）

---

## 环境变量状态

- `Qwen_Pro_API_KEY`: exists (len=38) — 主 provider
- `Ali_API_KEY`: missing — skeleton only

---

## 阶段完成状态

- [x] A: 现状审查 + 执行计划
- [ ] B: SSOT 五件套
- [ ] C: 归档旧文件到 ClawBin
- [ ] D: Backend skeleton
- [ ] E: Frontend skeleton
- [ ] F: Sprompt runtime 接入
- [ ] G: 联调最小闭环
- [ ] H: 文档更新 + Git + GitHub

---

# Execution Plan: Router baseline v0.1

**创建时间：** 2026-03-18  
**状态：** COMPLETE  
**目标：** 将系统从单 task 直派升级为 CLAW → Router → WorkItems → RouteGroups → Bot/Run 架构

---

## 执行步骤

### Step 1: 接口契约先行 [DONE]
- [x] 更新 SSOT/interfaces.md，新增 WorkItem / RouteGroup / RouterDecision / RouterReviewResult / RouteGroupRuntime / RouteGroupResult 对象契约
- [x] 更新 `/api/tasks/{id}/result` 返回结构说明

### Step 2: Sprompt 规范更新 [DONE]
- [x] `Sprompt/constitutional/01_layered_architecture.md` 增加 Layer 1.5 Router 章节
- [x] 新增 `Sprompt/operational/06_router_policy.md`（拆分规则、组装规则、Wait Gate 挂点）
- [x] 新增 `Sprompt/prompts/roles/Router.md`（Router 角色 prompt）

### Step 3: Router 后端实现 [DONE]
- [x] 新增 `backend/router/__init__.py`
- [x] 新增 `backend/router/types.py`（WorkItem / RouteGroup / RouterDecision 等 7 个数据类）
- [x] 新增 `backend/router/splitter.py`（规则驱动 WorkItem 拆分）
- [x] 新增 `backend/router/grouping.py`（保守 RouteGroup 组装）
- [x] 新增 `backend/router/router.py`（Router 主入口）

### Step 4: RuntimeStore 扩展 [DONE]
- [x] 扩展 `backend/runtime_store/store.py`，新增 10 个 Router 相关存储方法
- [x] `get_full_task_result()` 升级，自动包含 Router 产物

### Step 5: Validator 扩展 [DONE]
- [x] `backend/validator/engine.py` 新增 `validate_router()` 函数
- [x] R-001 到 R-005 五项 Router 结构检查
- [x] router_validation 字段注入 validation_report

### Step 6: Orchestrator 升级 [DONE]
- [x] `backend/orchestrator/orchestrator.py` 重构为 Router pipeline
- [x] 新增 `normalize_task_input()`, `build_task_contract()`, `run_router()`, `build_route_group_runtime()`, `dispatch_route_groups()`
- [x] `process_task_async()` 升级为 Router-aware 流程

### Step 7: Frontend 更新 [DONE]
- [x] `frontend/src/App.jsx` 新增 Router Summary 面板（WorkItems/RouteGroups 数量、dispatch_ready）
- [x] 新增 WorkItems 列表区块（id/title/mode/priority/status/isolation_required）
- [x] 新增 RouteGroups 列表区块（id/mode/bot_name/status/work_item_ids/blocking_reason）
- [x] Validation Report 面板新增 Router Validation 子报告展示

### Step 8: 端到端验证 [DONE]
- [x] 单目标任务 → 1 WorkItem, 1 RouteGroup, PARTIAL（TBD whitelist warning）
- [x] 三项序号列表 → 3 WorkItems, 1 merged RouteGroup, PARTIAL
- [x] `GET /api/tasks/{id}/result` 返回 Router 相关字段

### Step 9: SSOT 文档最终对齐 [DONE]
- [x] SSOT/state.md 更新（Router baseline 事实）
- [x] SSOT/decisions.md 追加 D023-D032
- [x] SSOT/roadmap.md 更新（Done/Now/Next）
- [x] SSOT/execution_plan_baseline.md 追加本轮计划

---

## 验证结果

| 测试项 | 输入 | 预期 | 实际 | 状态 |
|--------|------|------|------|------|
| 单目标 WorkItem | goal="Explain FastAPI" | 1 WorkItem | 1 WorkItem | PASS |
| 序号列表拆分 | "1. Build\n2. Auth\n3. Test" | 3 WorkItems | 3 WorkItems | PASS |
| RouteGroup 合并 | 3 project_mode WorkItems | 1 merged RG | 1 RG (3 WIs) | PASS |
| RouterDecision 存储 | 任意任务 | router_decision.json | exists | PASS |
| validate_router | 3 WI decision | PARTIAL (TBD) | PARTIAL | PASS |
| API 返回 Router 字段 | GET result | work_items/route_groups | present | PASS |
| Frontend Router 面板 | 完成任务 | 显示 WI/RG/Summary | rendered | PASS |

## 风险与已知限制

1. **RouteGroup 串行执行**：dispatch_route_groups() 当前串行，只返回最后一个 RG 的 run_id。多 RG 场景下，只有最后一个 RG 的 agent_result 被存储到主 run。需在 Next 里程碑拆开。
2. **TBD whitelist 永久触发**：editable_scope 默认为空，所有任务都会有 TBD warning 导致 dispatch_ready=false。需要接入真实的 editable_scope 推断。
3. **WorkItem 拆分精度**：当前规则驱动，keyword-level 分隔。对语义复杂输入可能分割不准确。
