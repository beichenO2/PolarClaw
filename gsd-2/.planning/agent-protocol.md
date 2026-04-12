# gsd-2 Multi-Agent Coordination Protocol

## Agents

| ID | Role | Responsibility |
|----|------|----------------|
| agent-a | Architect | 接口定义、类型系统、协议规范。输出到 `src/types.ts` 和 `docs/` |
| agent-b | Engineer | 实现代码、单元/集成测试。消费 agent-a 的类型定义 |
| agent-c | Integrator | 端到端测试、文档、STATE.md 更新、最终验证 |

## File Ownership (Conflict Prevention)

每个 Agent 只能写入自己拥有的文件。违反此规则的写入必须被拒绝。

| Agent | Owned Files | Read-Only |
|-------|------------|-----------|
| agent-a | `src/types.ts`, `src/protocol/`, `docs/api-spec.md` | all others |
| agent-b | `src/server.ts`, `src/transport/`, `src/persistence/`, `src/session/`, `src/tasks/`, `src/broadcast/`, `src/config/`, `tests/unit/`, `tests/integration/` | `src/types.ts`, `src/protocol/` |
| agent-c | `tests/e2e/`, `docs/` (except api-spec.md), `.planning/STATE.md`, `.planning/ROADMAP.md` | all `src/` |

## Coordination via Filesystem Signals

Agents coordinate through signal files under `.planning/signals/`:

### Handoff Signal
When agent-a finishes a type/interface definition:
```
.planning/signals/ready-{phase}-{component}.signal
```
Content: list of files that are ready for consumption.

### Completion Signal  
When an agent finishes its full task:
```
.planning/signals/done-{agent-id}-{phase}.signal
```

### Blocking Signal
When an agent is blocked waiting for another:
```
.planning/signals/blocked-{agent-id}.signal
```
Content: what it's waiting for, from whom.

## Commit Convention

Each agent commits with prefix: `[agent-{id}]`
```
[agent-a] feat(types): define task lifecycle interfaces
[agent-b] feat(tasks): implement task claim and lease
[agent-c] test(e2e): verify multi-agent task workflow
```

## Execution Order Within a Phase

1. **agent-a** starts first: defines interfaces and types
2. **agent-a** writes ready signal when types are complete
3. **agent-b** polls for ready signal, then implements
4. **agent-b** writes ready signal when implementation is done
5. **agent-c** polls for agent-b's ready signal, then tests/documents
6. **agent-c** writes done signal and updates STATE.md

## Loop Contract

Each agent runs this loop:
```
while true:
  1. Read .planning/signals/ for incoming signals
  2. Check own task queue (current phase's work)
  3. If prerequisites met → execute task
  4. If prerequisites not met → wait 30s, re-check
  5. Write output files
  6. git commit with agent prefix
  7. Write completion/ready signal
  8. Check if more work exists for current phase
  9. If no more work → write done signal → poll for next phase assignment
```

## Current Assignment: Phases 2-6

All remaining phases need to be completed. Each phase follows the pattern:
- agent-a: define new types/interfaces for the phase
- agent-b: implement the code
- agent-c: test and document

Phase order: 2 → 3 → 4 → 5 → 6 (sequential, as each depends on prior)
