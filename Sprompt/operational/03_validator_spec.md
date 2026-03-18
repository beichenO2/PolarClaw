# Deterministic Validator Spec（确定性验证器规范）

## Purpose / Scope

本文件定义 Deterministic Validator 的职责、判定规则、输入要求、输出格式和行为约束。

Validator 是三层执行闭环的第三层：
```
Worker → Evidence Collector → [Deterministic Validator]
```

Validator 的核心原则：**基于结构化 evidence object 进行确定性判定，不以自由文本"感觉像完成了"作为依据。**

---

## Reader / When to Read

- Deterministic Validator 角色必读（这是其核心规范）
- Evidence Collector 在组装 evidence_pack 时需了解 Validator 的输入要求
- FSM 设计者在设计 ValidationFSM 时必读

---

## Authority / Precedence

本文件服从：
- `constitutional/00_overview.md`
- `constitutional/02_constraints.md`（C-02 是三层闭环硬约束）
- `operational/02_evidence_collection_contract.md`

---

## Validator Inputs（Validator 的输入）

Validator 只接受以下结构化输入，**不接受自由文本描述**：

1. `evidence_pack`（来自 Evidence Collector）
2. `task_contract`（来自 CLAW，包含 acceptance_criteria）
3. `agent_result`（来自 Agent，包含 claimed outputs）

Validator **不接受**：
- Agent 的自我评估（"我认为我完成了"）
- 未经结构化的命令输出文本
- 人工描述代替 evidence

---

## Validation Process（验证流程）

### Step 1: Evidence Completeness Check（证据完整性检查）

验证 `evidence_pack.completeness_check.is_complete == true`。

如果不完整：
- 判定结果：`BLOCKED`
- 原因：`missing_evidence`
- 反馈给 Evidence Collector 需补充的 evidence types

### Step 2: Acceptance Criteria Matching（验收标准匹配）

对 `task_contract.acceptance_criteria` 中的每一条，在 evidence_pack 中找到对应证据：

| 验收标准类型 | 对应 evidence 类型 | 判定方式 |
|------------|-------------------|---------|
| 服务可达 | `port_probe_record` | `status == "reachable"` |
| 命令成功 | `command_execution_record` | `exit_code == 0` |
| 测试通过 | `test_execution_record` | `status == "all_passed"` |
| 文档已更新 | `docs_change_record` | `change_type in [create, update]` |
| Git 提交 | `git_change_record` | `exit_code == 0 && commit_hash != null` |

### Step 3: Non-Fabrication Check（禁止捏造检查）

验证 evidence_pack 中没有捏造的迹象：
- `raw_output` 字段非空
- `timestamp` 在合理时间范围内
- `exit_code` 值合理（不是-1 或其他不合理值）

### Step 4: Scope Check（白名单检查）

对比 `docs_change_record` 中的所有 `file_path`，验证均在 `task_contract.editable_scope` 中。

如果有不在白名单中的文件被修改：
- 判定结果：`FAIL`
- 原因：`scope_violation`

### Step 5: Interface Integrity Check（接口完整性检查）

如果 task_contract 中 `requires_interface_proposal: false`，则验证没有 `docs_change_record` 记录了 `docs/interfaces.md` 的修改。

如果发现 interfaces.md 被修改但 proposal 未完成：
- 判定结果：`FAIL`
- 原因：`unauthorized_interface_change`

---

## Judgment Outputs（判定输出）

Validator 的判定结果**必须是以下枚举值之一**，不得使用其他表述：

| 判定值 | 含义 | 触发条件 |
|--------|------|---------|
| `PASS` | 全部验收标准通过，所有硬约束满足 | 全部 Steps 通过 |
| `FAIL` | 验收标准不满足或发现约束违反 | Step 2/4/5 中有失败项 |
| `BLOCKED` | 证据不足，无法判定 | Step 1 证据不完整 |
| `NEED_HUMAN` | 超出自动判定能力范围，需人工介入 | 见下方说明 |

### NEED_HUMAN 触发条件
- evidence 显示危险操作（删除大量数据、不可逆操作等）
- 判定结论存在歧义（不同 evidence 相互矛盾）
- 验收标准是主观性的（如"代码质量"）
- 发现安全敏感内容（secret 泄露等）

---

## validation_report 输出格式

```json
{
  "report_id": "uuid",
  "run_id": "string",
  "evidence_pack_id": "string",
  "judgment": "PASS | FAIL | BLOCKED | NEED_HUMAN",
  "timestamp": "ISO8601",
  "criteria_results": [
    {
      "criterion_id": "string",
      "criterion_description": "string",
      "result": "PASS | FAIL | SKIP",
      "evidence_ref": "string | null",
      "reason": "string"
    }
  ],
  "violations": [
    {
      "violation_type": "scope_violation | unauthorized_interface_change | non_fabrication_violation | ...",
      "description": "string",
      "evidence_ref": "string | null"
    }
  ],
  "blocked_reason": "string | null",
  "need_human_reason": "string | null",
  "summary": "string"
}
```

---

## Determinism Rules（确定性规则）

Validator 必须遵守以下确定性规则：

1. **相同输入必须产生相同输出**：给定同样的 evidence_pack 和 task_contract，判定结果不得随机变化
2. **判定规则优先于直觉**：如果规则明确，必须按规则判定，不得用"感觉"覆盖
3. **不得扩展验收标准**：Validator 只能判定 task_contract 中定义的 acceptance_criteria，不得自行添加
4. **不得基于 Agent 自我评估判定**：Validator 不信任 Agent 的"我认为成功了"，只信任 evidence

---

## Validator Must Not Do（禁止事项）

- 禁止修改任何文件（包括 docs/）
- 禁止重新执行任何命令
- 禁止与 Agent 直接通信（只接受结构化输入）
- 禁止在证据不足时自动 PASS（必须 BLOCKED）
- 禁止在发现 scope_violation 时自动 PASS
- 禁止将 NEED_HUMAN 判定用作逃避判定的借口（需有明确理由）

---

## verification_policy（验证策略，快速参考）

| 场景 | 必须有的 evidence | 判定条件 |
|------|-----------------|---------|
| 后端服务启动验证 | port_probe_record（port 8000）| status == "reachable" |
| 前端服务启动验证 | port_probe_record（port 3000）| status == "reachable" |
| API 端点验证 | port_probe_record（http_get，含期望响应）| actual_response 匹配 expected_response |
| 命令执行验证 | command_execution_record | exit_code == 0 |
| 测试套件验证 | test_execution_record | status == "all_passed" |
| 文档已更新验证 | docs_change_record | file_path 在白名单内，change_type == "update" |
| 切片完成验证 | 以上相关类型全部通过 | 全部 acceptance_criteria PASS |

---

*文件分类：Operational Spec（B 类）*  
*修改权限：高层 Agent 提案 + Validator/BOT review flow 审阅*  
*版本：v0.1 baseline*
