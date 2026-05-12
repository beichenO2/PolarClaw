# PolarClaw Roadmap

> 进度视图：当前阶段、完成情况、下一步。事实源是 `polaris.json`，本文件只做进度摘要。

## 当前状态

| 维度 | 状态 |
| --- | --- |
| 版本 | 0.1.0 |
| 项目状态 | active |

## Requirement 完成情况

| ID | 名称 | 完成度 | 说明 |
| --- | --- | --- | --- |
| R1 | ReAct 工具调用 Agent 核心 + 多通道交互 | 100% | 全部 done |
| R2 | 主动关怀与调度系统 | 100% | 全部 done |
| R3 | YOLO 自主执行模式 | 100% | 全部 done |
| R4 | Web 控制台与文档审阅 | 100% | 全部 done |
| R5 | 生态技能集成 | 100% | 全部 done |
| R6 | 元技能架构 + 生态地图 | 100% | 全部 done |
| R7 | PolarUser 统一身份模型 | 100% | 全部 done |
| R8 | PolarClaw SDK/API | 100% | users/events/lobsters/targets/approvals + HTTP API + project-sdk |

## 已知阻塞项

无。

## 下一步

1. PilotRuntime 实现（依赖 R7 + R8）。
2. SOTAgent 事件 API 上线后切换 events.emit 主通道。
3. 各项目接入 polarclaw-project-sdk。

## 更新记录

| 日期 | 更新内容 |
| --- | --- |
| 2026-05-05 | ComputerUse VLM analyze 路径跑通（截图 → 本地 llama-server Gemma 3 4B）；PolarPrivate proxy → qwen3-coder-plus observe/act 路径同时可用；launchd 常态化部署 |
| 2026-05-01 | R7 PolarUser + R8 SDK/API 完成 |
| 2026-04-29 | 初始创建：从 polaris.json 提取进度信息 |
