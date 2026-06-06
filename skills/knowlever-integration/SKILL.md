---
name: knowlever-integration
description: 与 KnowLever 知识编译引擎集成 — RAG 检索、Topic 管理、代码库摄入、LLM 编译
version: 3.0.0
requires:
  knowlever-rag: "http://127.0.0.1:18080"
---

# KnowLever Integration

API 契约对齐 `KnowLever/rag/api_server.py`（`python -m rag.api_server`，默认端口 18080，经 port-sdk 发现 `knowlever-rag`，网关前缀 `knowlever`）。

## 能力

- **RAG 语义检索**：`POST /api/search` — 向量相似度搜索，支持 `user`/`topic` 过滤
- **Topic 列表**：`GET /api/topics` — 返回 `name`、`wiki_pages`、`raw_docs`
- **文本摄入**：`POST /api/ingest` — 分块索引，支持 `user`、`extra_meta.topic`
- **异步编译触发**：`POST /api/compile/trigger` — 后台队列执行 compile + build
- **Wiki 页面浏览**：`GET /api/topics/{topic}/pages`、`/pages/{page}`
- **Q&A 回灌**：`POST /api/feedback` — 高质量问答写入 wiki 并重新索引
- **代码库摄入**：CLI `wiki-engine/ingest.js --from-codebase`
- **同步 LLM 编译**：CLI `wiki-engine/_legacy/compile.js`（细粒度：source/dry-run/limit）
- **静态站构建**：CLI `wiki-engine/_legacy/build.js`

## 工具列表

| 工具 | 调用方式 | 关键参数 |
|------|----------|----------|
| `knowlever_query` | `POST /api/search` | `query`（必填）, `top_k`, `user`, `topic` |
| `knowlever_list_topics` | `GET /api/topics` | `user` |
| `knowlever_ingest` | `POST /api/ingest` | `text`, `doc_id`（必填）, `user`, `topic` |
| `knowlever_ingest_codebase` | CLI ingest.js | `input`, `topic`（必填）, `user`, `domain` |
| `knowlever_compile` | CLI _legacy/compile.js | `topic`（必填）, `user`, `source`, `force`, `dry_run`, `limit` |
| `knowlever_compile_trigger` | `POST /api/compile/trigger` | `topic`（必填）, `user`, `force`, `source` |
| `knowlever_build` | CLI _legacy/build.js | `topic`（必填）, `user` |
| `knowlever_list_pages` | `GET /api/topics/{topic}/pages` | `topic`（必填）, `user` |
| `knowlever_get_page` | `GET /api/topics/{topic}/pages/{page}` | `topic`, `page`（必填）, `user` |
| `knowlever_feedback` | `POST /api/feedback` | `topic`, `query`, `answer`（必填）, `quality_score` |

## 调用时机

- 用户问专业问题、需要背景知识 → `knowlever_query`
- 用户问"知识库里有什么" → `knowlever_list_topics`
- 用户要求保存知识/笔记到知识库 → `knowlever_ingest`
- 用户想分析某个开源项目/代码库 → `knowlever_ingest_codebase` → `knowlever_compile_trigger`
- 需要细粒度同步编译（指定 source、dry-run）→ `knowlever_compile`
- 编译后要生成可浏览站点 → `knowlever_build`（或由 compile_trigger 自动执行）
- 浏览已编译 wiki 内容 → `knowlever_list_pages` + `knowlever_get_page`
- 高质量问答需要沉淀 → `knowlever_feedback`
- 生成报告前需要补充上下文 → `knowlever_query`（或走 autooffice_enrich）

## 代码库摄入流程

典型流程（三步走）：
1. `knowlever_ingest_codebase` — 摄入代码库
2. `knowlever_compile_trigger` — 异步触发 LLM 编译 + 静态站构建
3. （可选）`knowlever_list_pages` — 确认 wiki 页面已生成

细粒度控制时改用同步 CLI：
1. `knowlever_ingest_codebase`
2. `knowlever_compile`（可 `--dry-run` / `--limit` / `--source`）
3. `knowlever_build`

## 与 AutoOffice 的关系

AutoOffice 的 `/api/enrich` 内部也调用 KnowLever RAG。如果只需要"增强现有文档"，
用 `autooffice_enrich` 更方便。`knowlever_query` 适合直接检索原始知识上下文。

## 依赖

- KnowLever RAG API 运行中（`knowlever-rag` 服务，默认 :18080）
- SOTAgent port-sdk（:4800，网关 `http://127.0.0.1:4800/gw/knowlever/...`）
- KnowLever 项目存在于 `~/Polarisor/KnowLever/`（或 `KNOWLEVER_DIR`）
- LLM 编译需要 PolarPrivate 服务（默认 `http://127.0.0.1:12790`，`POLARPRIVATE_PORT` 可覆盖）

## 与旧版差异（v2.0 → v3.0）

- `knowlever_query`：Python 子进程 `RAGPipeline.build_context` → `POST /api/search`；新增 `user`/`topic`；默认 `top_k` 5
- `knowlever_list_topics`：文件系统遍历 → `GET /api/topics`；返回 `wiki_pages`/`raw_docs` 统计
- `knowlever_ingest`：Python 子进程 → `POST /api/ingest`；新增 `user`/`topic`
- `knowlever_compile`：路径 `wiki-engine/compile.js` → `wiki-engine/_legacy/compile.js`
- `knowlever_build`：路径 `wiki-engine/build.js` → `wiki-engine/_legacy/build.js`
- 新增 `knowlever_compile_trigger`（HTTP 异步编译）
- 新增 `knowlever_list_pages`、`knowlever_get_page`、`knowlever_feedback`
