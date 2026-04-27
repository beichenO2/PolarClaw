---
name: radar-ranging
description: 雷达测距与距离分辨率实验 — 全流程自动化（数据解压→数据处理→图表生成→实验报告）
version: 1.0.0
requires:
  polarprivate-llm-proxy: "http://127.0.0.1:12790"
  unar: "/opt/homebrew/bin/unar"
  python3: "PATH"
  llama-vision: "http://127.0.0.1:1234"
---

# 雷达测距与距离分辨率实验 Skill

## 能力

- **Phase 1 — 解压数据**：调用 `unar` 解压来自 Windows 的 RAR 文件，自动处理 GBK/UTF-8 编码
- **Phase 2 — 数据处理**：生成并执行 Python 分析脚本，对 FMCW 雷达原始数据做 FFT、距离谱计算、目标定位
- **Phase 3 — 图表生成**：输出距离谱图、FFT 频谱图、距离分辨率对比图等（保存到 output/）
- **Phase 4 — 报告生成**：LLM（MiniMax-M2.7-highspeed）逐章节生成内容，用 officecli 组装 .docx

## 工具列表

- `radar_ranging_run`: 完整流程 — 解压 → 处理数据 → 生成图 → 写报告（主入口）
- `radar_ranging_extract`: 仅 Phase 1 — 解压 RAR 数据到 data/ 目录
- `radar_ranging_process`: 仅 Phase 2+3 — 运行 Python 脚本处理数据、生成图表
- `radar_ranging_report`: 仅 Phase 4 — 生成实验报告 .docx（需图表已存在）
- `radar_ranging_health`: 检查依赖（unar、python3、LLM proxy、llama）

## 调用时机

- 完整实验流程 → `radar_ranging_run`
- 仅需要解压数据 → `radar_ranging_extract`
- 数据已解压，仅重跑分析 → `radar_ranging_process`
- 图表已生成，仅重写报告 → `radar_ranging_report`

## 模型策略

| 任务 | 模型 | 端点 |
|------|------|------|
| 报告章节生成 | MiniMax-M2.7-highspeed | PolarPrivate :12790 |
| 图片内容分析（辅助） | google/gemma-3n-e4b | llama.cpp :1234 |
| Bug 调试 / 复杂推理 | qwen-max | PolarPrivate :12790 |

## 实验背景

FMCW（调频连续波）雷达测距原理：
- 发射线性调频信号，接收混频后得到差频（beat frequency）
- 距离 R = (f_beat × c) / (2 × B/T) = f_beat × c × T / (2B)
- 距离分辨率 ΔR = c / (2B)，B 为带宽
- FFT 变换得到距离谱，峰值对应目标距离
