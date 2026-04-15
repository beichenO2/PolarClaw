---
name: knowlever-integration
description: 与 KnowLever 知识编译引擎集成 — RAG 检索、Topic 管理、知识图谱查询
version: 1.0.0
requires:
  knowlever-dir: "~/Polarisor/KnowLever"
---

# KnowLever Integration

## 能力

- RAG 混合检索（BM25 + 向量）：从知识库中检索与问题相关的上下文
- Topic 列表查询：了解知识库中有哪些主题
- 知识摄入：将新文档写入知识库索引

## 工具列表

- `knowlever_query`: RAG 检索 — 根据查询返回知识库中的相关上下文
- `knowlever_list_topics`: 列出知识库中所有可用的 Topic
- `knowlever_ingest`: 将文本摄入知识库（建立索引）

## 调用时机

- 用户问专业问题、需要背景知识 → `knowlever_query`
- 用户问"知识库里有什么" → `knowlever_list_topics`
- 用户要求保存知识/笔记到知识库 → `knowlever_ingest`
- 生成报告前需要补充上下文 → `knowlever_query`（或走 autooffice_enrich）

## 与 AutoOffice 的关系

AutoOffice 的 `/api/enrich` 内部也调用 KnowLever RAG。如果只需要"增强现有文档"，
用 `autooffice_enrich` 更方便。`knowlever_query` 适合直接检索原始知识上下文。

## 依赖

KnowLever 项目需存在于 `~/Polarisor/KnowLever/`（或设置 `KNOWLEVER_DIR` 环境变量）。
RAG 管道通过 Python 子进程调用，需要 python3 且能导入 `rag.pipeline`。
