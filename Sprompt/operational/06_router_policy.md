# Router Policy

## Document Authority

本文件服从 `constitutional/01_layered_architecture.md`（Router 层章节）。  
本文件定义 Router 层的操作规则、拆分规则、组装规则和 Wait Gate 挂点。  
任何与架构文件冲突的内容，以架构文件为准。

Last Updated: 2026-03-18 (Router baseline v0.1)

---

## 1. Router 职责边界

Router 位于 CLAW/Orchestrator 与 Executor 之间。

**Router 必须做：**
- 接收 `task_contract`，读取 `normalized_input` 或 `goal`
- 拆解为 `WorkItem[]`（每个 WorkItem 必须有完整结构化字段）
- 组装为 `RouteGroup[]`
- 输出 `RouterDecision`（含 dispatch_ready 判断）
- 输出 `RouterReviewResult`（摘要）
- 为每个 RouteGroup 生成 `RouteGroupRuntime`

**Router 不得做：**
- 调用 Model / FSM 执行任务
- 修改 task_contract 的 task_id / session_id / goal
- 把模糊输入直接透传给后续 Bot（必须至少做一次结构化）
- 把未知 editable_scope 伪装成已知值（必须写 TBD）
- 脑补用户意图（保守拆分 + warning，不猜测）

---

## 2. WorkItem 拆分规则（Baseline v0.1）

拆分优先级：

| 优先级 | 规则 | 示例 |
|--------|------|------|
| 1（最高）| 显式序号列表 `1. / 2. / (1) (2)` | `1. Build API\n2. Add auth` |
| 2 | Bullet 列表 `- / • / *` | `- Task A\n- Task B` |
| 3 | 分隔词（中英文）| `另外/再/顺便/同时/additionally/also/furthermore` |
| 4（默认）| 保守：整段 = 1 WorkItem | 无明确分隔符 |

**每个 WorkItem 必须包含：**

```
work_item_id    (UUID)
task_id         (继承自 task_contract)
title           (最多 80 字符的目标摘要)
goal            (完整目标文本)
constraints     (继承 task_contract.constraints)
context         (继承 task_contract.context)
editable_whitelist  (继承 editable_scope，若为空则写 ["TBD"])
acceptance_criteria (最小一条)
recommended_mode    (规则推断: 含 build/fix/implement 关键字 → project_mode, 否则 knowledge_mode)
priority        (默认 medium)
status          (初始 pending)
isolation_required  (默认 false)
dependency_ids  (默认 [])
conflict_ids    (默认 [])
```

**不安全字段的处理：**
- `editable_whitelist` 未知 → 写 `["TBD"]`，并在 RouterDecision.warnings 中记录
- `acceptance_criteria` 无法推断 → 写最小占位标准，`is_tbd: true`
- 不得伪造已知值

---

## 3. RouteGroup 组装规则（Baseline v0.1）

**默认策略：一个 WorkItem → 一个 RouteGroup**（保守隔离）。

**合并条件（全部满足才可合并）：**

| 条件 | 说明 |
|------|------|
| `recommended_mode` 相同 | 不同 Mode 必须分 Group |
| `isolation_required == false` | 任一 WorkItem 要求隔离则不合并 |
| 无 dependency_ids 交叉 | WorkItem 间有依赖关系则分 Group |
| 无 conflict_ids 交叉 | WorkItem 间有冲突则分 Group |
| `editable_whitelist` 无路径重叠 | TBD 不视为冲突 |

**Bot 分配规则（Baseline v0.1）：**

| Mode | Bot |
|------|-----|
| `project_mode` | `ProjectMakerBot` |
| `knowledge_mode` | `KnowleverBot` |

**FSM 分配（Baseline v0.1）：**  
FSM 为 null。将在 FSM 层引入后填充。

---

## 4. RouterDecision 字段规则

| 字段 | 规则 |
|------|------|
| `dispatch_ready` | 只有 `required_confirmations` 为空时才为 true |
| `warnings` | 所有保守决策均须记录 warning |
| `required_confirmations` | 有 TBD whitelist 时必须包含 `"editable_whitelist_review"` |
| `blocked_task_state` | 目前为 null；未来 Human Gate 触发时填写 |
| `interface_change_proposal` | 检测到需要接口变更时填写；目前为 null |

---

## 5. Wait Gate 挂点（预留）

以下字段在 Router baseline v0.1 中已定义但尚未激活：

| 字段 | 所在对象 | 说明 |
|------|----------|------|
| `wait_gate_event` | RouteGroup / RouteGroupRuntime | 等待特定事件才能继续 |
| `blocked_task_state` | RouterDecision | 任务级阻塞状态 |
| `human_confirmation_required` | RouteGroup / RouteGroupRuntime | 需要人工确认 |
| `interface_change_proposal` | RouterDecision | 检测到接口变更需求 |

未来实现时：
- 当 `human_confirmation_required = true` 时，Router 输出 `dispatch_ready = false`
- 前端展示 Human Action 面板
- 用户确认后才继续 dispatch

---

## 6. Evidence 记录要求

Router 执行后，至少需记录：

1. **路由输入摘要**：goal 字符数、检测到的分隔方式
2. **WorkItem 拆分记录**：每个 WorkItem 的 ID、title、mode
3. **RouteGroup 组装记录**：每个 RouteGroup 的 ID、work_item_ids、bot_name
4. **warnings 列表**

这些信息通过 `RouterDecision` 和 `RouterReviewResult` JSON 文件保存到 RuntimeStore。

---

## 7. Validator 要求

Router 产物必须通过以下验证才能标记为 PASS：

| 检查 | 编号 | 规则 |
|------|------|------|
| WorkItem 存在 | R-001 | 至少 1 个 WorkItem |
| WorkItem goal 非空 | R-002 | 每个 WorkItem.goal 不能为空字符串 |
| RouteGroup 存在 | R-003 | 至少 1 个 RouteGroup |
| RouteGroup 引用有效 WorkItem | R-004 | work_item_ids 必须全部在 WorkItem 集合中 |
| RouterDecision 可追踪 | R-005 | task_id 和 created_at 必须存在 |

有 warnings 无 violations → 判定为 PARTIAL（可接受，需记录）  
有 violations → 判定为 FAIL
