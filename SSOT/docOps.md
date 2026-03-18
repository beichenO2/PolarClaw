# DocOps Policy

This project uses SSOT/ as the authoritative project memory.

## Files

- `SSOT/state.md` — 系统当前状态，最高权威
- `SSOT/interfaces.md` — API 契约，contract-first
- `SSOT/decisions.md` — 决策日志，append-only
- `SSOT/roadmap.md` — 路线图，可以有偏差
- `SSOT/docOps.md` — 本文件，文档操作规范

## Authority Order

```
state.md > interfaces.md > decisions.md > roadmap.md
```

## Update Triggers

- **state.md**: milestone 状态变化、端口/命令变化、验收测试结果变化
- **interfaces.md**: 任何接口 schema 变化（先改此文件，再改代码）
- **decisions.md**: 做出了非平凡的技术选择（只追加）
- **roadmap.md**: 发现新需求、优先级变化

## Backup Policy

修改任何 SSOT 文件前，先创建 .bak 备份（覆盖已有 .bak）。  
rollback depth = 1。

## ClawBin Archival Policy

**规则: 禁止删除项目文件。废弃文件必须移动到 `/Users/mac/Desktop/ClawBin/`。**

归档记录格式（记录到本文件的 Archive Log 部分）:
```
| 原始路径 | ClawBin 路径 | 归档原因 | 时间 |
```

这条规则同时写入：
- Sprompt/constitutional/02_constraints.md（作为 C-11）
- 本文件

## Archive Log

| 原始路径 | ClawBin 路径 | 归档原因 | 时间 |
|---------|-------------|---------|------|
| docs/state.md | ClawBin/docs_legacy/state.md | 迁移到 SSOT/ | 2026-03-18 |
| docs/interfaces.md | ClawBin/docs_legacy/interfaces.md | 迁移到 SSOT/ | 2026-03-18 |
| docs/decisions.md | ClawBin/docs_legacy/decisions.md | 迁移到 SSOT/ | 2026-03-18 |
| docs/roadmap.md | ClawBin/docs_legacy/roadmap.md | 迁移到 SSOT/ | 2026-03-18 |
| docs/docOps.md | ClawBin/docs_legacy/docOps.md | 迁移到 SSOT/ | 2026-03-18 |
| prompt | ClawBin/prompt_legacy | 被 Sprompt/ 体系替代 | 2026-03-18 |
| 经验.md | ClawBin/经验_legacy.md | 历史记录，已沉淀到 Sprompt/ | 2026-03-18 |
| 通用经验.md | ClawBin/通用经验_legacy.md | 已迁移到 Sprompt/migration/ | 2026-03-18 |
| backend/llm_provider.py | (keep in place, deprecated) | 被 model_gateway/ 替代，保留作参考 | 2026-03-18 |

## GitHub Sync Policy

**定期 commit 和 push 是工程纪律要求。**

规则：
- 每完成一个功能模块，立即 commit
- 每完成一个阶段，立即 push
- 重要里程碑必须 push
- commit 注释必须清晰描述目的（feat/refactor/docs/chore）

命令参考：
```bash
git add .
git commit -m "feat: ..."
git push origin main
```

## Non-Fabrication Rule

文档中的事实必须是已验证的。  
未知值写 TBD，不猜测，不提前打 [x]。

## Self-Evolution File Classification

- A 类 (constitutional/): 修改需高层提案 + 人工审阅
- B 类 (operational/, schemas/, roles/): 修改需 review flow
- C 类 (examples/, runtime/): 可自动生成/更新
