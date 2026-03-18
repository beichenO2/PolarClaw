# Interface Change Gate（接口变更门控规范）

## Purpose / Scope

本文件详细定义接口变更门控流程（Interface Change Gate）。  
这是 CLAW 系统中一个不可绕过的治理机制：任何接口变更必须先经过提案和确认，才能修改代码。

本文件将接口变更门控从"临时文字约定"提升为**消息协议的正式组成部分**。

---

## Reader / When to Read

- 任何 Executor/Agent 在执行涉及 API 修改的任务时必读
- CLAW 在分析任务时如果检测到接口变更信号必读
- FSM 设计者在设计需要接口变更流程的 FSM 时必读

---

## Authority / Precedence

本文件服从：
- `constitutional/02_constraints.md`（C-04 是接口变更硬约束）
- `constitutional/04_communication_policy.md`（interface_change_proposal 协议）

---

## What Counts as Interface Change（什么算接口变更）

以下操作都需要走接口变更门控流程：

| 操作 | 是否需要门控 |
|------|------------|
| 修改现有 API endpoint 的请求体字段 | 是 |
| 修改现有 API endpoint 的响应体字段 | 是 |
| 新增 API endpoint | 是 |
| 删除 API endpoint | 是 |
| 重命名 API endpoint | 是 |
| 修改 HTTP 方法 | 是 |
| 修改内部接口（LLMProvider.generate 签名等）| 是 |
| 修改错误响应格式 | 是 |
| 仅修改实现，不改接口 schema | 否（不需要门控）|
| 修改代码内部变量名 | 否 |

---

## Interface Change Gate Flow（门控流程）

```
检测到需要变更接口
    ↓
立即停止当前执行（不得继续）
    ↓
生成 interface_change_proposal（JSON）
    ↓
当前 Run → BLOCKED 状态
    ↓
推送 human_action_request（action_type: interface_change_confirmation）
    ↓
    ├── 用户/高层 Agent 审批 → APPROVED
    │       ↓
    │   更新 docs/interfaces.md（先备份 .bak）
    │       ↓
    │   追加 docs/decisions.md 条目
    │       ↓
    │   恢复 Run，继续执行（代码修改必须与新接口一致）
    │
    └── 用户/高层 Agent 拒绝 → REJECTED
            ↓
        Run 状态 → FAILED 或 needs_revision
        记录拒绝原因
        通知 CLAW 重新规划
```

---

## interface_change_proposal 必须包含的字段

（完整 schema 见 `schemas/interface_change_proposal.json`）

```json
{
  "proposal_id": "uuid",
  "run_id": "string",
  "agent_id": "string",
  "created_at": "ISO8601",
  "interface_file": "docs/interfaces.md",
  "change_type": "add_endpoint | remove_endpoint | modify_request | modify_response | modify_internal",
  "target": "string (端点路径或接口名)",
  "before": { "description": "变更前的 schema（JSON 或文本）" },
  "after": { "description": "变更后的 schema（JSON 或文本）" },
  "reason": "string (为什么需要这个变更)",
  "impact_scope": ["string (受影响的组件列表)"],
  "status": "pending | approved | rejected",
  "reviewed_by": "string | null",
  "reviewed_at": "ISO8601 | null",
  "review_notes": "string | null"
}
```

---

## Approval Authority（审批权限）

| 变更类型 | 审批者 |
|---------|--------|
| 新增 endpoint（不破坏现有接口） | CLAW 审核 + 用户确认 |
| 修改现有 endpoint（破坏性变更） | 必须人工确认 |
| 删除 endpoint | 必须人工确认 |
| 修改内部接口 | CLAW 审核 + 用户确认 |

---

## Post-Approval Checklist（审批后检查清单）

审批通过后，Executor 必须按以下顺序执行：

```
[ ] 1. 备份 docs/interfaces.md → docs/interfaces.md.bak
[ ] 2. 更新 docs/interfaces.md，与 proposal.after 一致
[ ] 3. 追加 docs/decisions.md（格式：日期 + 决策编号 + 一行描述）
[ ] 4. 恢复 Run 执行
[ ] 5. 代码修改必须以更新后的 interfaces.md 为准
[ ] 6. 生成 docs_change_record（type: docs_change_record）
[ ] 7. 验证修改后的接口与代码实现一致
```

---

## Rejection Handling（拒绝后处理）

审批被拒绝后：

1. `interface_change_proposal.status = "rejected"`
2. 记录 `review_notes`（为什么拒绝）
3. 当前 Run 状态转为 `FAILED` 或 `needs_revision`
4. 通知 CLAW，说明无法按原计划执行的原因
5. CLAW 重新分析，生成新的 task_contract（不修改接口的版本）

---

## Violation Detection（违规检测）

Validator 在最终验证时必须检查：
- 是否有 `docs/interfaces.md` 被修改的 `docs_change_record`
- 如果有修改但 `interface_change_proposal.status != "approved"`，判定为 FAIL（`unauthorized_interface_change`）

---

*文件分类：Operational Spec（B 类）*  
*修改权限：高层 Agent 提案 + Validator/BOT review flow 审阅*  
*版本：v0.1 baseline*
