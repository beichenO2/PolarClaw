# 龙虾（Lobster）开发路线图 — Round 2

> Round 1 完成 Phase 1-3（安全、记忆、规划）。Round 2 全部外部依赖已就绪，推进剩余工作 + 工具集成。

## Wave 1: 独立模块（Round 1 已完成）

### Phase 1: 安全体系
- 状态: done (Round 1)
- 验证: 14/14 PASS

### Phase 2: 长期记忆增强
- 状态: done (Round 1)
- 验证: PASS

### Phase 3: 柔性规划引擎
- 状态: done (Round 1)
- 验证: PASS

## Wave 2: Round 2 核心工作

### Phase 4: 全流程自动化
- 目标: 开发→测试→修复→验证全自动流水线
- 需求: REQ-C04
- 状态: in_progress (Round 2 最高优先级)
- 产出: 自动测试运行器 + CI 流水线

### Phase 5: 核心编排完善
- 目标: apps/core 完整串联所有模块，一键 `npm start`
- 需求: REQ-E01, REQ-E02
- 状态: pending
- 产出: 完整的启动入口 + 模块编排

### Phase 6: 消息通道桥接
- 目标: Telegram/飞书 Bot 真正连接 Runtime
- 需求: REQ-E03, REQ-E04, REQ-G03
- 状态: pending
- 产出: Telegram+飞书 → Runtime 实时对话

### Phase 7: Web Dashboard 实数据
- 目标: Web 控制台对接真实 API，替换 mock
- 需求: REQ-E05, REQ-H02~H05
- 状态: pending
- 产出: 可用的 Web Dashboard

### Phase 8: 研究引擎增强
- 目标: 多源搜索、学术论文、结构化报告
- 需求: REQ-F02, REQ-F03, REQ-F04
- 状态: pending
- 产出: 增强的 apps/research

## Wave 3: 外部集成（Round 2 解锁）

### Phase 9: 信息获取对接
- 目标: 对接 Digest 项目的爬虫 API
- 需求: REQ-E06
- 状态: unblocked (digest.crawl_api ready)
- 产出: 爬虫集成适配器

### Phase 10: 知识杠杆对接
- 目标: 对接 KnowLeverage 的 RAG 引擎
- 需求: REQ-E07
- 状态: unblocked (knowleverage.rag_engine ready)
- 产出: RAG 集成适配器

### Phase 11: LLMWiki + 自动化办公对接
- 目标: 对接 Wiki 生成和报告生成
- 需求: REQ-E08, REQ-E09
- 状态: unblocked (llmwiki + autooffice ready)
- 产出: Wiki + 报告生成适配器

## Wave 4: 工具集成（MASTER-PLAN 第八章）

### Phase 13: MemPalace 记忆宫殿集成
- 目标: MCP 协议接入 MemPalace, 替代自研记忆系统部分功能
- 来源: MASTER-PLAN §8.2 第一优先级
- 状态: pending
- 产出: MemPalace MCP 适配器 + 记忆迁移

### Phase 14: OpenSpace Skills 自进化
- 目标: 集成 HKUDS OpenSpace, 实现 Skills 自动优化
- 来源: MASTER-PLAN §8.2 第二优先级
- 状态: pending
- 产出: 自进化引擎增强

### Phase 15: 加密货币工具套件
- 目标: 安装 BlockBeats+CoinMarketCap+CoinAnk+Dune 四套工具
- 来源: MASTER-PLAN §8.2
- 状态: pending
- 产出: 4 个加密货币 Skill 集成

### Phase 16: CLI Anything + VPN 退化
- 目标: Clash Verge 转 CLI 工具 + 断网 Gemma 降级
- 来源: MASTER-PLAN §8.2
- 状态: pending
- 产出: CLI 工具包 + 降级策略

### Phase 17: OpenTwitter MCP + mcp-use
- 目标: 推特信息获取 + MCP 标准化工具集成
- 来源: MASTER-PLAN §8.1
- 状态: pending
- 产出: OpenTwitter 适配器 + mcp-use 集成层

## Wave 5: 端到端验证

### Phase 12: 全系统集成测试
- 目标: 用比特币量化交易研究场景验证所有功能
- 需求: 所有 REQ
- 状态: pending
- 前置: Wave 2-4 完成
