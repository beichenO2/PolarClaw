---
name: polarclaw-ops
description: PolarClaw 项目运维指南
---

# PolarClaw — 使用指南

## 核心信息

| 维度 | 值 |
|---|---|
| 健康端点 | http://127.0.0.1:3000/api/health |
| 启动命令 | `npm start` |
| 安装命令 | `npm ci` |
| 重启命令 | `bash Start/start.sh` |
| 技术栈 | Node.js 22 + Express + better-sqlite3 + React 18 |

## 快速启动

```bash
cd ~/Polarisor/PolarClaw
npm ci
npm start
```

## 启动模式

- `npm start` — 默认（CLI 模式）
- `npm start -- --mode hub-web` — Hub Web 模式
- `bash Start/start.sh` — 后台守护启动
