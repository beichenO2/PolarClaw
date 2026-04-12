# 技术方案有效性验证报告

**日期**: 2026-04-10
**方法**: 上网搜索 2025-2026 年业界资料，对比 MyClaw 现有方案

---

## 1. 记忆检索：FTS5 vs 向量嵌入

### 调研来源

- [FTS5 vs Vector Search: When to Use Keyword vs Semantic Search Locally (BSWEN, 2026-03)](https://docs.bswen.com/blog/2026-03-17-fts5-vs-vector-search/)
- [ZeroClaw Hybrid Memory: SQLite Vector + FTS5 (2026-02)](https://zeroclaws.io/blog/zeroclaw-hybrid-memory-sqlite-vector-fts5/)
- [Hybrid full-text + vector search with SQLite (Alex Garcia, sqlite-vec 作者)](https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/index.html)
- [AI Agent Memory Systems 2026 综述 (Mem0, Zep, Hindsight 对比)](https://yogeshyadav.medium.com/ai-agent-memory-systems-in-2026-mem0-zep-hindsight-memvid-and-everything-in-between-compared-96e35b818da8)
- [Mem0 Technical Analysis (Southbridge.AI)](https://www.southbridge.ai/blog/mem0-technical-analysis-report)

### 结论

| 维度 | FTS5（我们当前方案） | 向量嵌入 | 混合方案（业界推荐） |
|------|---------------------|---------|---------------------|
| 精确召回 | 优秀（1-5ms） | 弱 | 优秀 |
| 语义召回 | 无法做到 | 优秀 | 优秀 |
| 依赖 | 零（SQLite 内置） | 需要嵌入模型 | 需要 sqlite-vec 扩展 |
| 运维成本 | 零 | Pinecone $70/月起 | 零（同一个 SQLite 文件） |
| 适用场景 | 用户知道关键词 | "部署问题" 匹配 "push broke" | 两者兼顾 |

**判定**：我们的 FTS5 方案**有效但不完整**。

- **有效性确认**：FTS5 + BM25 在精确关键词检索场景下完全合格，响应时间 1-5ms，零依赖
- **已知短板**：无法处理语义相似（用户描述模糊时会漏召回）
- **业界共识**：2025-2026 的主流做法是 **FTS5 + sqlite-vec 混合检索**，用 Reciprocal Rank Fusion (RRF) 合并排名。ZeroClaw 等同类项目已采用此方案

### 改进计划

引入 `sqlite-vec` 扩展，在现有 SQLite 文件内增加向量表，实现 FTS5 + 向量的 RRF 混合检索。保持零外部依赖的架构优势。

---

## 2. 意图路由：正则分类 vs NLU / LLM

### 调研来源

- [Regex vs BERT vs LLMs for Text Classification (Medium, Vibha Hegde)](https://medium.com/@hegdevibha21/regex-vs-bert-vs-llms-balancing-rules-context-and-reasoning-for-smarter-text-classification-cd2f9c0bc176)
- [Beyond Regex: Modern Text Classification in Production (Towards AI, 2026-01)](https://pub.towardsai.net/beyond-regex-a-simple-guide-to-modern-text-classification-in-production-95591bd357ce)
- [Benchmarking Hybrid LLM Classification Systems (Voiceflow)](https://www.voiceflow.com/blog/benchmarking-hybrid-llm-classification-systems)

### 结论

| 维度 | 正则（我们当前方案） | NLU 模型 | LLM 分类 | 混合方案 |
|------|---------------------|---------|---------|---------|
| 速度 | 微秒级 | 毫秒级 | 秒级 | 毫秒级 |
| 成本 | 零 | 推理成本 | API 调用费 | 较低 |
| 确定性 | 完全确定 | 高 | 不确定 | 高 |
| 语义理解 | 无 | 有 | 强 | 有 |
| 适用类别数 | < 10 | 10-100 | 任意 | 10-100 |

**判定**：我们的正则方案**在当前 4 个意图类别下有效且合理**。

- **有效性确认**：4 个意图（coding/research/vision/general）边界清晰、关键词区分度高，正则完全胜任
- **业界验证**：2026 年生产系统普遍采用"正则快速路径 + NLU/LLM 兜底"的分层架构。对于类别数少、边界清晰的场景，正则是推荐的第一层
- **成本优势**：正则零成本、确定性强，避免了每次路由都消耗 LLM 调用

### 改进建议（非紧急）

当意图类别扩展到 8+ 个时，考虑增加 LLM 兜底层：正则无法匹配时，调一次 LLM 做最终分类。当前 4 类无需改动。

---

## 3. 研究管线：简化 Planner vs DeerFlow 原版

### 调研来源

- [DeerFlow: Complete Guide (ByteDance, 47,000+ GitHub stars)](https://medium.com/@2315610426/deerflow-by-bytedance-the-complete-guide-to-the-open-source-super-agent-that-researches-codes-99192db52a5f)
- [DeerFlow Sub-Agent Parallel Execution (BSWEN)](https://docs.bswen.com/blog/2026-03-16-deerflow-subagents)
- [DeerFlow Researcher 系统架构深度解析 (CSDN)](https://devpress.csdn.net/v1/article/detail/151374541)
- [GPT-Researcher vs DeerFlow Architecture Compared (BlestLabs)](https://blestlabs.com/blog/agentic-workflow-langgraph-comparison)

### 对比

| 组件 | DeerFlow 原版 | MyClaw 当前实现 | 差距 |
|------|-------------|---------------|------|
| Coordinator | LLM 驱动的工作流管理 | 简单文本规范化 | 大 |
| Planner | LLM 生成子问题分解 | 启发式分句 | 中 |
| Researcher | 并行子 Agent + 搜索 | 串行 Wikipedia 查询 | 中 |
| Coder | 专用代码执行节点 | 无 | 有（但非必需） |
| Reporter | LLM 综合报告生成 | 模板化拼接 | 小 |
| 技术栈 | LangChain + LangGraph | 纯 Node.js | 不同路线 |

**判定**：我们的简化方案**功能可用，但与 DeerFlow 的深度研究能力有明显差距**。

- **有效性确认**：启发式分句 + Wikipedia 证据收集 + 模板报告，对简单研究主题（单一主题、信息密集）有效
- **已知短板**：
  - 启发式分句无法像 LLM 那样理解主题结构并生成有针对性的子问题
  - 串行搜索效率低于 DeerFlow 的并行子 Agent
  - 缺少 Coder 节点，无法处理需要计算/对比的研究任务
- **DeerFlow 推荐参数**：`AGENT_RECURSION_LIMIT=8-12`（简单任务），启用 background investigation 减少探索轮次

### 改进计划

1. **短期**：Planner 增加 LLM 模式（可选），当 `config.research.llmPlanner` 为 true 时调用 LLM 生成子问题
2. **中期**：Researcher 支持并行搜索（Promise.allSettled）
3. **长期**：参考 DeerFlow 增加 Coder 节点处理计算型研究任务

---

## 总结

| 模块 | 当前方案 | 有效性 | 改进优先级 |
|------|---------|--------|-----------|
| 记忆检索 | FTS5 only | 有效但不完整 | **高**（增加 sqlite-vec 混合检索） |
| 意图路由 | 正则分类 | **有效且合理** | 低（4 类意图无需改动） |
| 研究管线 | 启发式 Planner | 基本可用 | 中（增加 LLM Planner 可选模式） |
| LLM 配置 | 已更新为 Coding Plan | **已确认有效** | 已完成 |
| Evolution | 定时抓取 Coding Plan 文档 | **已确认有效** | 已完成 |
