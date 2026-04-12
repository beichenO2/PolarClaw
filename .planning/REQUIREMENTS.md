# 龙虾（Lobster）需求清单 — Round 2 更新

> 对照 MASTER-PLAN.md §3.1 编排。状态：done / wip / pending / blocked

## A. 安全（Round 1 完成）

- [REQ-A01] 沙箱隔离 — done (apps/security/src/sandbox.mjs)
- [REQ-A02] GitHub 上传安全 Skill — done (apps/security/src/git-guardian.mjs)
- [REQ-A03] 强制 private repo — done (apps/security/src/git-guardian.mjs)
- [REQ-A04] 外部接口安全 — done (apps/security/src/api-guard.mjs)
- [REQ-A05] 安全最佳实践自研 — done (apps/security/src/best-practices.mjs)

## B. 高效

- [REQ-B01] Skills 自进化 — done (apps/evolution)
- [REQ-B02] 工具库持续扩充 — wip (Phase 15-17 工具集成中)
- [REQ-B03] 多 Agent 协作 — done (gsd-2 v0.5.1)
- [REQ-B04] LLM 智能路由 — done (apps/llm, 16 tests pass)
- [REQ-B05] 百炼 API 配置与模型管理 — done

## C. 自动

- [REQ-C01] YOLO 模式永不停止 — done (apps/yolo)
- [REQ-C02] 长期记忆系统 — done (Round 1)
- [REQ-C03] 强化学习 — done (Round 1)
- [REQ-C04] 全流程自动：开发→测试→修复→验证 — done (Round 2: 4 suites, 61 tests, scripts/test-all.sh)
- [REQ-C05] 记忆全局集成 — done

## D. 主观能动性（Round 1 完成）

- [REQ-D01] 主动沟通 — done
- [REQ-D02] 柔性规划 — done (10 tests pass)
- [REQ-D03] 主动关怀 — done
- [REQ-D04] 经验驱动预判 — done
- [REQ-D05] Cron 定时任务调度器 — done

## E. 集成层

- [REQ-E01] apps/core 完整编排 — done (agent.mjs 728 行完整编排)
- [REQ-E02] 启动入口 npm start — done (start.mjs + banner + .env)
- [REQ-E03] Telegram Bot 对接 Runtime — wip (桥接基础在 channels.mjs)
- [REQ-E04] 飞书 Bot 对接 Runtime — wip (桥接基础在 channels.mjs)
- [REQ-E05] Web Dashboard 对接真实 API — pending
- [REQ-E06] 对接信息获取 digest.crawl_api — done (Round 2: digest-adapter.mjs)
- [REQ-E07] 对接知识杠杆 knowleverage.rag_engine — done (Round 2: knowleverage-adapter.mjs)
- [REQ-E08] 对接 LLMWiki llmwiki.wiki_generator — done (Round 2: llmwiki-adapter.mjs)
- [REQ-E09] 对接自动化办公 autooffice.report_gen — done (Round 2: autooffice-adapter.mjs)

## F. 研究引擎

- [REQ-F01] DeerFlow 管线 — done
- [REQ-F02] 多源搜索引擎集成 — pending
- [REQ-F03] 学术论文搜索 — pending
- [REQ-F04] 结构化研究报告 — pending
- [REQ-F05] 交互式内容生成 — done

## G. 消息通道

- [REQ-G01] Telegram Bot 基础 — done
- [REQ-G02] 飞书 Bot 基础 — done
- [REQ-G03] 任务完成通知推送 — pending

## H. 前端

- [REQ-H01] GitHub 风格 Web Dashboard — wip
- [REQ-H02] 结果导向展示 — pending
- [REQ-H03] 自进化面板 — pending
- [REQ-H04] 任务进度看板 — pending
- [REQ-H05] 研究报告可视化 — pending

## I. 工具集成（MASTER-PLAN 第八章）

- [REQ-I01] MemPalace 记忆宫殿 MCP — pending (Phase 13)
- [REQ-I02] OpenSpace Skills 自进化 — pending (Phase 14)
- [REQ-I03] BlockBeats 加密货币 — pending (Phase 15)
- [REQ-I04] CoinMarketCap — pending (Phase 15)
- [REQ-I05] CoinAnk — pending (Phase 15)
- [REQ-I06] Dune MCP — pending (Phase 15)
- [REQ-I07] CLI Anything + VPN 退化 — pending (Phase 16)
- [REQ-I08] OpenTwitter MCP — pending (Phase 17)
- [REQ-I09] mcp-use 标准化集成 — pending (Phase 17)

## 统计
- done: 28 (+8 from Round 2)
- wip: 4
- pending: 13
- blocked: 0
- 总计: 45
