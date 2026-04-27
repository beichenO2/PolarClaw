---
name: radar-ranging-mat
description: 雷达实验 MATLAB 路线 — 通过 MATLAB Engine API 调用 .p 加密算法处理全部雷达数据（回环/测距/测速/测角）
version: 1.0.0
requires:
  matlab-engine: "/Users/macbook/Polarisor/macbook/Class/雷达实验/雷达测距和距离分辨率/.venv_mat"
  polarprivate-llm-proxy: "http://127.0.0.1:12790"
---

# 雷达实验 MATLAB 路线 Skill

与 `radar-ranging`（纯 Python/numpy 路线）**并行的第二条技术路线**。使用 MATLAB Engine API for Python 调用老师提供的 `.p` 加密核心算法，获得权威的信号处理结果。

> ⚠️ 所有产出文件隔离在 `code_mat/`、`output_mat/`、`report_mat/` 目录，不影响 Python 路线。

## 工具列表

- `radar_mat_process`: 主入口 — 启动 MATLAB Engine，依次处理 4 类实验的 13 个数据文件，输出图表 + JSON
- `radar_mat_report`: 调用 lab-report skill 生成 _mat 实验报告
- `radar_mat_run`: 完整流程（process → report）
- `radar_mat_health`: 检查 MATLAB Engine、venv、数据文件是否就绪

## 调用时机

- 完整流程 → `radar_mat_run`
- 仅数据处理 → `radar_mat_process`
- 图表已生成，仅写报告 → `radar_mat_report`
- 环境诊断 → `radar_mat_health`

## 处理的实验

| 实验 | Demo 脚本 | 数据文件数 |
|------|----------|-----------|
| 回环测试 | `Recycle_Demo.m` + `pRecycle_Demo.p` | 2 |
| 测距 | `Range_Demo.m` + `pRange_Demo.p` | 6 |
| 测速 | `Speeding_CFAR_MTI_Demo.m` + `pSpeeding_CFAR_MTI_Demo.p` | 2 |
| 测角 | `RadarSignalProcessing_LFMCW.m` + `pRadarSignalProcessing_LFMCW.p` | 3 |

## 技术实现

Python 桥接脚本 (`code_mat/process_mat.py`) 通过 `matlab.engine` 启动 MATLAB，使用 `eng.eval()` 在 base workspace 中：
1. `cd` 到 demo 目录（确保 `.p` 文件可被找到）
2. 设置雷达参数 + 覆盖 `binFilePath` / `B` / `N_frame`
3. 执行数据加载 + `.p` 算法
4. 提取结果变量 + `saveas(gcf)` 保存图片
