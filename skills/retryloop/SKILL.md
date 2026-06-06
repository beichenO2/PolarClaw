---
name: retryloop
description: RetryLoop 智能路由 — 检测用户显式 RetryLoop 指令并执行 YOLO 多轮迭代
version: 0.1.0
origin: static
status: verified
trigger: ["RetryLoop", "重试循环", "多轮执行", "反复执行"]
tools: ["retryloop_detect", "retryloop_confirm", "retryloop_status"]
---

# RetryLoop

检测用户消息中的 RetryLoop 指令（如"RetryLoop 5 次"），区分讨论和执行请求，触发 YOLO + 多轮迭代。

## 工作流程

1. 用户发送包含 "RetryLoop N 次/循环" 的消息
2. 系统检测到触发信号（排除"解释 RetryLoop"等讨论）
3. 向用户澄清：执行内容、停止条件
4. 用户确认后进入 YOLO 模式 + RetryLoop 执行
5. 每轮执行后检查停止条件，达标则提前结束

## 触发规则

- 触发："给我 RetryLoop 5 次" / "retryloop 3 循环" / "执行 RetryLoop 7 遍"
- 不触发："解释一下 RetryLoop" / "什么是 RetryLoop"

## 与 YOLO 的关系

RetryLoop = YOLO 澄清 + 多轮 YOLO 执行。先对齐任务目标，再反复执行确保质量。
