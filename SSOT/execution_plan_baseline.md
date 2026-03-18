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
