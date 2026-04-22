# Diff 模式设计经验总结

> MyClaw Web 审核产物（PDF + PPT）开发过程中积累的 diff/review 设计原则。

## 核心设计原则

### 1. 分层渲染

```
原始文件 → 渲染层（PDF canvas / PPT image）→ 标注覆盖层（SVG overlay）→ 交互层
```

渲染层和标注层严格分离。渲染层只负责显示原始内容，标注层用 SVG 覆盖在渲染层上方，交互层处理鼠标事件。这样保证了：
- 标注不污染原始内容
- 缩放/翻页时标注坐标可以正确转换
- 不同渲染引擎（pdfjs-dist / LibreOffice PNG）可以共享相同的标注层

### 2. 归一化坐标

所有标注坐标使用 0-1 归一化值（相对于页面宽高），而非像素值。

好处：
- 缩放后坐标不变
- 不同分辨率渲染结果一致
- 后端存储与前端渲染解耦

### 3. Agent Diff 结构化

PPT diff 使用结构化 JSON（不是文本 diff），每条 diff 记录：

```json
{
  "slide_index": 2,
  "change_type": "modify",
  "target": "标题文本框",
  "before": "旧标题",
  "after": "新标题"
}
```

好处：
- 前端可以精确高亮变更位置
- 用户可以逐条审核、逐条接受/拒绝
- Agent 收到的反馈是结构化的，不需要解析自然语言

### 4. 双向 Diff

用户修改同样生成结构化 diff，与 Agent 的 diff 格式一致。这样 Agent 收到的不是"用户说了什么"而是"用户改了什么"。

### 5. 渐进降级

| 场景 | 理想方案 | 降级方案 |
|------|----------|----------|
| PDF 渲染 | pdfjs-dist 真实渲染 | 文件下载链接 |
| PPT 渲染 | LibreOffice headless → PNG | 上传预渲染图片 |
| Diff 展示 | 结构化 JSON 高亮 | 纯文本 before/after |
| 标注提交 | 实时推送到 Agent | 批量打包提交 |

## 技术选型经验

| 组件 | 选型 | 替代方案 | 为什么选这个 |
|------|------|----------|--------------|
| PDF 渲染 | pdfjs-dist | react-pdf | pdfjs-dist 更底层，可以控制 canvas 渲染 |
| PDF 标注 | 自研 SVG overlay | annotpdf / hypothes.is | 需要与 Agent 交互，现有库都面向人工审核 |
| PPT → 图片 | LibreOffice headless | Aspose / Google Slides API | 免费 + 本地部署 |
| 文件存储 | 本地 JSON + 文件系统 | SQLite BLOB | Review 数据量小，文件系统更直观 |

## 踩坑记录

1. **pdfjs-dist worker 线程**：必须单独打包为 chunk，否则主 bundle 过大（+1.3MB）
2. **SVG 坐标 vs Canvas 坐标**：SVG 的 viewBox 和 CSS transform 会影响坐标转换，需要用 `getBoundingClientRect()` 做转换
3. **LibreOffice headless 不稳定**：macOS 上偶尔卡死，需要加超时 + 重试
4. **better-sqlite3 ABI 兼容**：Node.js 版本升级后需要 `npm rebuild`，否则 ERR_DLOPEN_FAILED
