# PolarClaw — 故障排查

## 常见问题

### 服务无法启动

1. 检查 Node 版本: `node -v`（需要 >= 22）
2. 重新安装依赖: `npm ci`
3. 检查端口 3000: `lsof -i :3000`
4. 查看启动日志: `npm start 2>&1 | head -50`

### LLM 调用失败

1. 检查 PolarPrivate 是否在线: `curl http://127.0.0.1:<private-port>/health`
2. 检查 API Key 配置: 通过 PolarPrivate binding 管理
3. 查看 llm-usage.jsonl: `tail ~/.polarcop/logs/llm-usage.jsonl`

### 飞书消息不通

1. 检查飞书 Bot 凭证（通过 PolarPrivate Secret）
2. 检查 WebSocket 连接状态
3. 验证用户身份映射: `curl http://127.0.0.1:3000/api/sdk/users/admin`

### ComputerUse 截图失败

1. 检查 Chromium: `npx playwright install chromium`
2. 检查 Ollama VLM: `ollama list | grep qwen3-vl`
3. Docker 模式需要 `--no-sandbox`: 确认 Dockerfile 配置

### SQLite 数据库锁

1. 确认只有一个 PolarClaw 进程: `pgrep -f polarclaw`
2. 检查 WAL 模式: `sqlite3 data/*.db 'PRAGMA journal_mode;'`
