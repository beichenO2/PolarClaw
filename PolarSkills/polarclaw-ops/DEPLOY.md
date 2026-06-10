# PolarClaw — 部署指南

## 环境要求

- Node.js >= 22（.nvmrc 指定）
- better-sqlite3 需要 native build（`npm ci` 自动编译）
- 可选：Chromium for ComputerUse（Playwright 自动安装）

## 部署步骤

```bash
cd ~/Polarisor/PolarClaw
nvm use
npm ci
bash Start/start.sh
```

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| POLARCLAW_PROACTIVE | 启用主动关怀 | 0 |
| CLOCK_API_URL | Clock 服务地址 | http://127.0.0.1:5177 |
| COMPUTER_USE_DOCKER | 容器化浏览器 | 0 |

## Docker 部署（ComputerUse）

```bash
docker build -f Dockerfile.browser -t polarclaw-browser .
docker run -p 3000:3000 polarclaw-browser
```

## 健康检查

```bash
curl http://127.0.0.1:3000/api/health
```
