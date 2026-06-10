# PolarClaw — 使用指南

> 个人 AI Agent 融合平台：多通道交互、LLM 工具调用、隐私网关、YOLO 自主模式

## 核心信息

| 维度 | 值 |
|---|---|
| 健康端点 | 端口 3910（/api/status） |
| 启动命令 | `bash Start/start.sh start` |
| 安装命令 | `npm ci` |
| 技术栈 | Node.js v22+, TypeScript, 六边形架构(Port-Adapter) |

## 快速启动

```bash
cd ~/Polarisor/PolarClaw
npm ci
bash Start/start.sh start
```

## 健康检查

```bash
curl -s http://127.0.0.1:3910/api/status
```

## 依赖服务

- PolarPrivate (LLM 代理)
- KnowLever (知识检索)
- PolarMemory (记忆)
- SOTAgent (事件总线)
