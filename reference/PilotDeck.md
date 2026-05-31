# PilotDeck（参考克隆）

OpenBMB 任务制 Agent 平台，用于 Polarisor WorkSpace / 白盒记忆 / Always-On 借鉴。

- **上游**：https://github.com/OpenBMB/PilotDeck.git
- **许可证**：AGPL-3.0（本地克隆仅作只读参考；运行时记忆等在 PolarClaw 内重写，不 link 其 npm 包）
- **任务书**：`任务书/260531/PilotDeck_WorkSpace.md`

## 克隆（跳过 LFS 大媒体）

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/OpenBMB/PilotDeck.git PolarClaw/reference/PilotDeck
```

## 重点阅读路径（克隆后）

| 主题 | 路径 |
|------|------|
| WorkSpace 路径 | `reference/PilotDeck/src/pilot/paths.ts` |
| Always-On Gate | `reference/PilotDeck/src/always-on/runtime/DiscoveryGates.ts` |
| Always-On 五阶段 | `reference/PilotDeck/src/always-on/runtime/DiscoveryFire.ts` |
| 白盒记忆 | `reference/PilotDeck/src/context/memory/edgeclaw-memory-core/src/core/file-memory.ts` |
| 智能路由 | `reference/PilotDeck/src/router/tokenSaver/classifyAndRoute.ts` |
