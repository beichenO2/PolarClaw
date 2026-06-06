---
name: file-pipeline
description: 文件处理编排 — 接收文件后自动解压、读取、摄入 KnowLever、触发编译、主动汇报
version: 1.0.0
origin: static
status: verified
trigger: ["[ATTACHED_FILES]", "zip", "pptx", "docx", "pdf", "解压", "放到KnowLever", "编译成wiki"]
tools: ["file_extract", "file_batch_ingest"]
---

# File Pipeline

接收文件（从飞书/Web/CLI 上传）后，自动识别类型、提取内容、摄入 KnowLever 知识库、触发编译。

## 工具列表

| 工具 | 功能 | 关键参数 |
|------|------|----------|
| file_extract | 解压 zip/tar/rar/7z 到子目录 | path（文件路径）, output_dir（可选） |
| file_batch_ingest | 遍历目录，按文件类型提取内容并摄入 KnowLever | dir, topic, user, exclude_patterns |

## 触发时机

- 消息中出现 `[ATTACHED_FILES]` 标记 → 有文件需要处理
- 用户说"把这个放到 KnowLever"、"编译成 wiki"、"解压这个"
- 收到 zip/压缩包 → 先解压再处理
- 收到 PPT/DOCX/PDF → 提取内容再摄入

## 工作流编排

当检测到 `[ATTACHED_FILES]` 标记时：

### 步骤 1：解析文件列表
从 `[ATTACHED_FILES]` 块提取所有文件路径：
```
[ATTACHED_FILES]
- path: file:///path/to/file.zip type: file name: file.zip
- path: file:///path/to/slides.pptx type: file name: slides.pptx
```

### 步骤 2：按类型分流处理
对每个文件：
- **zip/tar/rar/7z** → `file_extract` 解压到同级 `_extracted/` 目录
- **pptx/docx/xlsx** → `doc_read` 提取文本内容
- **md/txt/json/csv** → 直接读取文本
- **pdf** → `doc_read` 或 `shell_exec` pdftotext 提取
- **图片** → 记录元信息，视觉内容需 VLM（可选）
- **其他** → 跳过并记录

### 步骤 3：摄入 KnowLever
根据用户意图和文件数量选择方式：
- 单文件文本 → `knowlever_ingest`（直接摄入文本）
- 解压后的目录 → `file_batch_ingest`（批量遍历+摄入）
- 代码库目录 → `knowlever_ingest_codebase`（代码库专用）

### 步骤 4：触发编译
- `knowlever_compile_trigger`（异步，适合大量内容）
- 或 `knowlever_compile`（同步，适合少量内容需要立即看结果）

### 步骤 5：汇报
- 小任务（< 30s）→ 直接回复用户
- 大任务（> 30s 或文件很多）→ 提交 PolarProcess，完成后主动推送

## 重任务委托（PolarProcess）

当检测到以下条件时，自动委托给 PolarProcess：
- 文件总大小 > 50MB
- 文件数量 > 10
- 预计处理时间 > 30s

委托方式：
```
POST http://127.0.0.1:11055/api/tasks/create
{
  "task_type": "file-pipeline",
  "command": "node PolarClaw/scripts/file-pipeline.js --dir {path} --topic {topic}",
  "work_dir": "/Users/mac/Polarisor",
  "owner": "polarclaw",
  "callback_url": "http://127.0.0.1:3910/api/task-callback",
  "callback_meta": { "userId": "{userId}", "channel": "{channel}" }
}
```

## 依赖

- safe-shell Skill（shell_exec 用于解压）
- doc-reader Skill（doc_read 用于 Office 文档）
- knowlever-integration Skill（摄入 + 编译）
- PolarProcess（重任务委托，可选）
- officecli CLI 工具（Office 文档提取）
