---
name: curator
description: Curator 技能治理 — 自动评分、合并、清理技能库，生成健康报告
version: 0.1.0
origin: static
status: verified
trigger: ["curator", "技能治理", "技能健康", "技能报告", "curator status"]
tools: ["curator_run", "curator_status", "curator_report"]
---

# Curator

后台技能治理模块，灵感来自 Hermes 的 Autonomous Curator。

## 功能

- **评分**：按使用次数 × 2 + 最近使用加分，为每个技能打分
- **合并**：同一 pattern 名的多个候选技能，保留最高分，移除重复
- **清理**：30 天未使用 + 失败多于成功的候选技能自动退役
- **报告**：生成 `logs/curator/REPORT-{date}.md` 包含排名和候选列表

## 运行方式

- 自动：7 天周期后台运行（`self-learning-loop.ts` 的 `curatorTimer`）
- 手动：用户说"curator status"或"技能健康报告"时触发

## 与 SOTAgent 技术资产的关系

Curator 管理 PolarClaw 内部技能的生命周期（执行层），SOTAgent 管理跨项目技能的注册和同步（治理层）。两者共存互补。
