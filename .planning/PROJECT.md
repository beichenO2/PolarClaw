# 龙虾（Lobster）— AI 助手主体

## 项目定位
融合 OpenClaw + DeerFlow + CloudCode 三个项目，打造具备安全、高效、自动、懂我、主观能动性的 AI 助手平台。龙虾是用户唯一的交互入口，其他四个项目（信息获取、知识杠杆、LLMWiki、自动化办公）都是龙虾的子系统。

## 技术栈
- **运行时**: Node.js 22+ / ESM (.mjs)
- **LLM**: 阿里云百炼 OpenAI 兼容协议
- **消息通道**: Telegram (Telegraf) + 飞书 (Lark SDK)
- **记忆层**: SQLite + FTS5
- **前端**: React + Vite (GitHub 风格 Dashboard)
- **协调**: gsd-2 Hub
- **参考项目**: openclaw/, deer-flow/, hermes-agent/

## 五大核心需求（来自 MASTER-PLAN.md §3.1）
| 编号 | 领域 | 关键词 | 外部依赖 |
|------|------|--------|---------|
| A | 安全 | 沙箱隔离、GitHub 审查、API 防护 | 无 |
| B | 高效 | Skills 自进化、多 Agent 协作 | 无 |
| C | 自动 | 永不停止、长期记忆+强化学习、全流程自动 | 部分依赖信息获取 |
| D | 主观能动性 | 主动沟通、柔性规划 | 无 |
| E | 集成 | 连接信息获取/知识杠杆/LLMWiki/自动化办公 | 全部依赖外部 |

## 现有代码状态（2026-04-10 扫描）
- 13 个模块已有实质代码（非空壳），88 个文件
- 核心集成层 apps/core 已存在，有 Agent 编排逻辑
- 主要缺口：security 模块缺失、Telegram/Feishu 桥接未接、Web 数据层为 mock、Memory 未全局集成
- 参考项目 openclaw/、deer-flow/、hermes-agent/ 完整存在

## 跨项目依赖（来自 MASTER-PLAN.md §二）
| 本项目需要 | 对方项目 | 能力标识 | 用途 |
|-----------|---------|---------|------|
| 爬虫 API | 信息获取 | digest.crawl_api | 获取外部信息 |
| RAG 引擎 | 知识杠杆 | knowleverage.rag_engine | 管理大知识库 |
| Wiki 生成 | LLMWiki | llmwiki.wiki_generator | 小专题整理 |
| 报告生成 | 自动化办公 | autooffice.report_gen | 输出结果 |

## 协调配置
- gsd-2 版本: v0.5.0+
- 项目哈希: bae4
- Hub 端口: 57844
- tmux 前缀: g-bae4
- 协调文件夹: ~/.gsd2/coordination/
