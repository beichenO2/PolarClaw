# PolarClaw — 故障排查

> 个人 AI Agent 融合平台：多通道交互、LLM 工具调用、隐私网关、YOLO 自主模式

## 健康检查

```bash
# 进程存活
pgrep -f "PolarClaw" || echo "NOT RUNNING"

# HTTP 端点
curl -s http://127.0.0.1:3910/api/status
```

## 关键端口

| 端口 | 说明 |
|---|---|
| 3910 | PolarClaw 主服务 |

## 常见故障

### 1. LLM 路由失败

**修复**：`检查 PolarPrivate: curl http://127.0.0.1:12790/api/health`

### 2. 飞书通道断连

**修复**：`检查飞书 Bot webhook 配置和网络`

### 3. Skill 加载失败

**修复**：`查看 data/skills/ 目录和 skill-registry`

## 依赖服务

- PolarPrivate (LLM 代理)
- KnowLever (知识检索)
- PolarMemory (记忆)
- SOTAgent (事件总线)

## 紧急恢复

```bash
cd ~/Polarisor/PolarClaw
bash Start/start.sh start
curl -s http://127.0.0.1:3910/api/status && echo 'OK' || echo 'BROKEN'
```
