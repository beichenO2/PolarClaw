# CLAW Roadmap

---

## Done

- [x] Sprompt/ 规范库建立（v0.1）
- [x] SSOT/ 文档体系建立
- [x] 旧项目代码 docs/ 归档
- [x] Backend skeleton（FastAPI + 模块化结构）
- [x] ModelGateway（QwenProvider + EchoProvider）
- [x] PromptAssembler + ContextPacker
- [x] RuntimeStore（JSON 文件存储）
- [x] ValidatorEngine（baseline skeleton）
- [x] Frontend CLAW Console（Task/Run/Result/Validation 面板）
- [x] 最小闭环联调

## Now (Baseline v0.1 polish)

- [ ] 补全 acceptance tests（端到端验证）
- [ ] 错误处理完善
- [ ] GitHub 推送
- [ ] Session 管理基础版

## Next

- [ ] FSM 定义（ProjectMainFSM, ValidationFSM）
- [ ] Evidence pack 完整收集（port probe, command execution）
- [ ] 完整 Deterministic Validator（基于 evidence_pack）
- [ ] Human Action 面板可交互
- [ ] Pattern 库建立（PortProbePattern, APISetupPattern）

## Later

- [ ] 向量检索 + pattern retrieval
- [ ] 自进化提案流程
- [ ] Multi-Agent 并发调度
- [ ] Knowledge mode 完整实现
- [ ] 完整 FSM 状态图

## Backlog

- [ ] AliCompatProvider 打通（Ali_API_KEY 获取后）
- [ ] Session 多轮上下文
- [ ] Web UI 移动端适配
- [ ] Docker 容器化
