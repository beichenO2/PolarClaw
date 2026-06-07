# 设计文档：飞书重任务工作流 + 消息合并

**日期**: 2026-06-07  
**状态**: 已实施  
**影响**: PolarClaw, PolarProcess

## 问题陈述

两个用户场景需要支持：

1. **飞书上传 zip → Claw 解压 → KnowLever 编译 → 主动汇报**：一个完整的重任务工作流
2. **飞书多条消息/文件合并**：同一用户在短时间内发送多条消息或多个文件时，智能合并为一次处理

## 断点分析

| # | 断点 | 根因 |
|---|------|------|
| 1 | attachments 在 handleChannelMessage 处被丢弃 | 类型签名只有 `{ channel, userId, text }`，无 attachments |
| 2 | Agent 不知道文件在哪 | text 里只有 `[文件] xxx.zip` 标签，没有本地路径 |
| 3 | 无多步编排 skill | 缺少 zip→解压→摄入→编译 的工作流指导 |
| 4 | PolarProcess 无完成回调 | 任务 done/failed 时不通知调用方 |
| 5 | Claw 无主动推飞书能力 | CareEngine 只用于关怀，不用于任务完成通知 |
| 6 | debounce 窗口过短 | 3s 窗口无法应对多文件上传（每个文件间隔可能 > 3s） |

## 解决方案

### 模块 1：Attachments 穿透

**文件**: `feishu.ts` L218-235, L280-286

- 存储路径改为 `PolarClaw/UserDocs/{userId}/{YYYY-MM-DD}/{filename}`
- 在 `dispatchSingle()` 中将文件元信息嵌入 text：`[ATTACHED_FILES]\n- path: file:///... type: file name: xxx.zip`
- Agent 的 LLM 看到这个标记，自然会用 shell_exec / doc_read 去操作文件
- 不需要改 agent.ts 接口（最小侵入性）

### 模块 2：自适应 Debounce

**文件**: `feishu.ts` enqueueMessage()

```
纯文本消息：debounceMs = 3s（保持现有）
含文件消息：fileDebounceMs = 60s（新增）
混合场景：任一消息含文件 → 整批升级为 60s
```

环境变量 `FEISHU_FILE_DEBOUNCE_MS` 可覆盖。

不需要 AbortSignal —— 等 60 秒比实现中断更简单可靠。

### 模块 3：file-pipeline Skill

**文件**: `skills/file-pipeline/SKILL.md` + `tools.ts`

两个工具：
- `file_extract`：解压 zip/tar/rar/7z
- `file_batch_ingest`：遍历目录，按类型提取内容（text 直读、Office 用 officecli、PDF 用 pdftotext），逐文件摄入 KnowLever

SKILL.md 包含完整工作流编排指导，让 Agent 的 LLM 知道收到文件后该怎么做。

### 模块 4：PolarProcess 任务完成回调

**文件**: `PolarProcess/src/db.ts`, `scheduler.ts`

- IHeavyTaskRow 新增 `callback_url` 和 `callback_meta_json` 字段
- DDL 新增对应列
- createTask() 接受 `callback_url` 和 `callback_meta` 参数
- 任务完成时 `fireCallback()` 向 callback_url POST 结果
- callback_meta 透传上下文（userId, channel 等）

### 模块 5：主动汇报通道

**文件**: `web/server.ts`, `main.ts`

- WebServerConfig 新增 `proactiveNotify` 回调
- `/api/task-callback` 端点接收 PolarProcess 回调
- `proactiveNotify` 实现：LLM 生成汇报文案 → 通过飞书适配器 send() 推送
- 路由逻辑：callback 带 meta.channel → 找到对应适配器 → send

## 完整工作流时序

```
用户(飞书) → 发送 zip + "放到KnowLever"
  ↓
feishu.ts: 下载文件 → PolarClaw/UserDocs/userId/2026-06-07/data.zip
  ↓
debounce(60s): 等待更多消息/文件...
  ↓
flushBatch: 合并 text + [ATTACHED_FILES] 标记
  ↓
handleChannelMessage → agent.handleMessage(text含文件路径)
  ↓
Agent ReAct 循环:
  1. LLM 看到 [ATTACHED_FILES] + "放到KnowLever"
  2. file_extract(path) 解压 zip
  3. file_batch_ingest(dir, topic) 批量摄入
  4. knowlever_compile_trigger(topic) 触发编译
  5. 回复 "已开始编译，完成后通知你"
  ↓
[若重任务] → PolarProcess task (callback_url=Claw:3910, meta={userId, channel})
  ↓
PolarProcess 执行完成 → POST /api/task-callback
  ↓
proactiveNotify → LLM 生成汇报 → feishuAdapter.send()
  ↓
用户在飞书收到: "编译完成，共生成 N 个 wiki 页面"
```

## 测试结果

- PolarClaw: 42 test files, 345 tests passed
- PolarClaw 编译: 0 errors
- PolarProcess: 3 pre-existing errors (unrelated to changes)
