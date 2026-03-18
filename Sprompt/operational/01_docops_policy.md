# DocOps Policy（文档操作规范）

## Purpose / Scope

本文件定义项目文档（`docs/` 文件夹）的操作规范，包括：
- 文档的权威顺序
- 什么时候更新哪个文档
- 备份与回滚规则
- 文档与 prompt/spec 体系的关系

---

## Reader / When to Read

- 任何 Executor/Agent 在准备修改 docs 文件前必读
- CLAW 在分析任务时如果涉及 docs 变更必读
- 人类维护者在手动修改 docs 前必读

---

## Authority / Precedence

本文件服从：
- `constitutional/00_overview.md`
- `constitutional/02_constraints.md`（其中 C-05 和 C-06 是 docs 相关硬约束）

本文件是对 `docs/docOps.md` 的系统级扩展，两者不冲突时均有效，冲突时以本文件为准（本文件是 operational 层，`docs/docOps.md` 是项目层，项目层规则须与系统层兼容）。

---

## System Prompt/Spec vs Project Docs（重要区分）

### 系统 prompt/spec（`Sprompt/`）
- 定义系统级规范、角色定义、通信协议、约束规则
- 面向：CLAW、Executor、Agent、Validator、人类维护者
- 生命周期：跨项目、跨任务，长期稳定

### 项目 docs（`docs/`）
- 定义项目级 runtime 记忆：当前状态、接口契约、决策日志、路线图
- 面向：当前项目的 Agent 执行上下文
- 生命周期：与项目绑定，随项目演进

**两者不得混淆。** `Sprompt/` 中的文件不等于 `docs/` 中的文件。

---

## docs Authority Order（文档权威顺序）

```
state.md   ← 最高权威（项目事实的 SSOT）
    ↓
interfaces.md  ← 接口契约（contract-first）
    ↓
decisions.md   ← 决策日志（append-only）
    ↓
roadmap.md     ← 路线图（可以有偏差，不作为权威）
```

---

## Update Triggers（更新触发条件）

### state.md 必须更新的情况
- 任何切片状态变化（DONE / IN PROGRESS / NOT STARTED）
- 运行目标（端口、命令）发生变化
- 验收测试结果发生变化
- 任何用户可见行为变化

### interfaces.md 必须更新的情况
- 任何 API endpoint 的请求/响应 schema 变化
- endpoint 新增、删除、重命名
- 内部接口契约变化（LLMProvider、MemoryStore、ToolRegistry 等）
- **接口更新必须先于代码变更**（contract-first 原则）

### decisions.md 必须更新的情况
- 做出了可能被未来重新评估的选择（框架、运行时、数据存储、API 设计等）
- 格式：日期 + 决策编号 + 一行理由
- **只能追加，禁止修改历史条目**

### roadmap.md 更新情况
- 发现新功能需求
- 切片顺序/优先级变化
- 允许有偏差，不作为权威依据

---

## Backup Rules（备份规则）

**硬规则（来自 C-05）：**

修改任何 docs 文件前，必须：

```
Step 1: cp docs/state.md docs/state.md.bak          （覆盖已有 .bak）
Step 2: 执行文档修改
Step 3: 报告：修改了哪些文档 + 每个文档的 changelog
Step 4: 同一次 run 内不删除 .bak 文件
```

.bak 文件在**下次任务开始时**才被新备份覆盖。

---

## Reading Order（执行前必读顺序）

所有 Executor/Agent 在开始执行任务前，**必须**按以下顺序读取文件：

```
1. docs/state.md           ← 理解当前项目状态
2. docs/interfaces.md      ← 了解当前接口契约
3. task_contract.editable_scope  ← 确认操作白名单
```

如果任务涉及决策，还需要读取：
```
4. docs/decisions.md       ← 了解已有决策，避免重复或冲突
```

**在完成以上读取之前，不得开始任何写操作。**

---

## Conflict Resolution（冲突处理）

当发现 docs 文件之间存在冲突：

1. **不得平均冲突**（不能取两者"中间值"）
2. 以 `state.md` 为准（对项目事实）
3. 记录发现冲突的事实
4. 提案修正冲突的文档（使其与 state.md 一致）
5. 等待确认后修正

---

## Non-Fabrication in Docs（文档中的禁止捏造规则）

- 文档中所有陈述必须是已验证的事实或明确标注为推断/TBD
- 禁止在 state.md 中写入未验证的状态
- 禁止在 decisions.md 中记录未实际发生的决策
- 禁止在 interfaces.md 中记录未实现的接口为"已完成"

---

## Output Format Requirements（文档修改后必须输出）

当 Executor/Agent 修改了任何 docs 文件，必须在结果中报告：

```
1. 修改了哪些文件
2. 每个文件的 changelog（bullet points）
3. 备份文件列表
4. 是否触发了接口变更流程
```

---

*文件分类：Operational Spec（B 类）*  
*修改权限：高层 Agent 提案 + Validator/BOT review flow 审阅*  
*版本：v0.1 baseline*
