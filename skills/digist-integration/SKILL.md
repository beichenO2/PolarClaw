---
name: digist-integration
description: 与 digist 信息采集引擎集成 — 爬取触发、数据搜索、推荐、状态监控
version: 1.1.0
requires:
  digist-api: "http://127.0.0.1:3800"
---

# DiGist Integration

API 契约对齐 `digist/src/api/server.ts`（`npm run digist-api`，默认端口 3800，经 port-sdk 发现 `digist-api`）。

## 能力

- 触发爬取：`POST /api/crawl/trigger` — twitter, reddit, wechat, github, glass, xiaohongshu, zhihu, arxiv, bilibili, hackernews, bloomberg, youtube
- 内容检索：`GET /api/content_items` + 本地关键词过滤（standalone API 无 FTS 端点）
- 个性化推荐：`GET /api/recommend`（参数 `n`、`platform`、`topics`、`user_id`）
- 健康状态：`GET /health?fast=1`、`/api/items/count`、`/api/scheduler/status`、`/api/lobster/status`
- 兴趣管理：`GET /api/interests`（可选 `user_id`）
- KnowLever 同步：`POST /api/sync-to-knowlever`（必填 `interest_id`，可选 `topic`/`user`/`dry_run`）

## 工具列表

| 工具 | digist 端点 | 关键参数 |
|------|-------------|----------|
| `digist_crawl` | `POST /api/crawl/trigger` | `platform`（必填）, `query`（glass/hackernews/bloomberg 可省略） |
| `digist_search` | `GET /api/content_items` | `query`（必填）, `platform`, `limit` |
| `digist_recommend` | `GET /api/recommend` | `n`（非 limit）, `platform`, `topics`, `user_id` |
| `digist_status` | `GET /health`, `/api/items/count`, `/api/scheduler/status`, `/api/lobster/status` | — |
| `digist_interests` | `GET /api/interests` | `user_id`（可选） |
| `digist_sync_to_knowlever` | `POST /api/sync-to-knowlever` | `interest_id`（必填）, `topic`, `user`, `dry_run` |

## 调用时机

- 用户说"看看最近有什么新闻/论文" → `digist_crawl` + `digist_recommend`
- 用户搜索某个技术话题 → `digist_search`
- 用户问"推荐点什么" → `digist_recommend`
- 用户问"digist 状态如何" → `digist_status`
- 用户说"同步到知识库" → 先 `digist_interests` 取 `interest_id`，再 `digist_sync_to_knowlever`

## 依赖

- digist API 运行在 :3800（或通过 port-sdk 发现 `service_name=digist-api`，网关前缀 `digist`）
- SOTAgent port-sdk 运行在 :4800（可选，用于端口自动发现）

## 与旧版差异（v1.0 → v1.1）

- `digist_search`：不再使用 `/api/items/recent?q=`（该参数不存在），改为 `/api/content_items` + 本地过滤
- `digist_recommend`：查询参数 `limit` 改为 `n`（与 digist API 一致）
- `digist_sync_to_knowlever`：`interest` 改为必填 `interest_id`；移除不存在的 `days` 参数
- `digist_crawl`：平台列表扩展至 12 个；非 no-query 平台强制校验 query
- `digist_status`：新增 `/api/lobster/status` 探测
