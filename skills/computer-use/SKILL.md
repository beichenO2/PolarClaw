# ComputerUse — 浏览器自动化技能

通过 Stagehand（Playwright 上层 AI 框架）实现浏览器自动化操作。
支持在隔离 Docker 环境中运行，不影响用户桌面。

## 功能

- **browse_and_act**: 自然语言驱动的浏览器操作（导航、点击、填写）
- **screenshot_and_analyze**: 页面截图 + VLM 视觉分析
- **fill_form**: 结构化表单自动填写

## 依赖

- `@browserbasehq/stagehand` — AI 浏览器框架
- `playwright` — 底层浏览器引擎
- Docker（可选）— 隔离运行环境

## 桌面隔离

设置 `COMPUTER_USE_DOCKER=1` 启用 Docker 隔离：
- 使用 `Dockerfile.browser` 构建包含 Chromium + Xvfb 的容器
- 浏览器操作在容器内完成，截图通过 volume 映射传回
