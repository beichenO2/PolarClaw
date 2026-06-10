# PolarClaw — 部署指南

> 个人 AI Agent 融合平台：多通道交互、LLM 工具调用、隐私网关、YOLO 自主模式

## 环境要求

- 技术栈：Node.js v22+, TypeScript, 六边形架构(Port-Adapter)
- 安装：`npm ci`

## 安装步骤

```bash
cd ~/Polarisor/PolarClaw
npm ci
```

## 启动方式

### launchd 常驻（推荐）

plist：`~/Library/LaunchAgents/com.polarisor.polarclaw (如有)`

```bash
launchctl load ~/Library/LaunchAgents/com.polarisor.polarclaw (如有)
launchctl start com.polarisor.polarclaw (如有)
```

### 手动启动

```bash
cd ~/Polarisor/PolarClaw
bash Start/start.sh start
```

## 端口分配

| 端口 | 用途 |
|---|---|
| 3910 | 主服务 |

## 健康检查确认

```bash
curl -s http://127.0.0.1:3910/api/status
```

## 回滚方式

```bash
cd ~/Polarisor/PolarClaw
git log --oneline -5
git checkout <previous-commit>
npm ci
bash Start/start.sh start
```
