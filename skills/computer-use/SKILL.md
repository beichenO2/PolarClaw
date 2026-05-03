---
name: computer-use
description: 浏览器自动化技能 — 通过 Stagehand（Playwright AI 层）执行自然语言驱动的浏览器操作，支持 Docker 隔离运行
version: 0.2.0
requires:
  node: ">=20"
---

# ComputerUse — 浏览器自动化技能

通过 Stagehand（Playwright 上层 AI 框架）实现浏览器自动化操作。
支持在隔离 Docker 环境中运行，不影响用户桌面。

## 工具列表

- `computer_use_browse` — 自然语言驱动的浏览器操作（导航、点击、填写）
- `computer_use_screenshot` — 页面截图 + 可交互元素观察
- `computer_use_fill_form` — 结构化表单自动填写

## 调用时机

- 需要打开网页并进行交互（点击、填写、滚动）→ `computer_use_browse`
- 需要对页面截图后 VLM 视觉分析 / UI 评分 → `computer_use_screenshot`
- 需要批量填写带描述字段的表单 → `computer_use_fill_form`

## 依赖

- `@browserbasehq/stagehand` — AI 浏览器自动化框架
- `playwright` — 底层浏览器引擎
- Stagehand 需要 LLM API（默认走 OpenAI/Anthropic；本项目可通过 PolarPrivate 代理或显式 `OPENAI_API_KEY`）
- Docker（可选）— 用于桌面隔离运行

## 桌面隔离

设置 `COMPUTER_USE_DOCKER=1` 启用 Docker 隔离模式：

- 使用 `Dockerfile.browser` 构建包含 Chromium + Xvfb 的容器
- 浏览器操作在容器内完成，截图通过 volume 映射回宿主
- 用户桌面不会被打扰

## 沙箱外暴露

ComputerUse 同时通过 PolarClaw SDK（`/api/sdk/computer-use/*`）以"沙箱外服务"形式暴露，
其他项目可使用 `polarclaw-project-sdk` 远程调用，详见 SSOT/interfaces.md。

## 安全约束

- 默认 headless 模式，不弹窗
- 截图保存到 `data/screenshots/`，文件名带时间戳
- Stagehand 调用失败会捕获并返回 `{ ok: false, error }`，不抛进 ReAct 循环
