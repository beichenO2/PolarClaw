---
name: clock-integration
description: 与 PolarClock 番茄钟系统集成，获取用户任务、日程、番茄状态
version: 1.1.0
requires:
  clock-backend: "http://127.0.0.1:15550"
---

# Clock Integration

与 Clock backend v1.1.0 API 对齐。

## 环境变量

| 变量 | 说明 |
|------|------|
| `CLOCK_API_URL` | Clock 后端地址（默认 `http://127.0.0.1:15550`） |
| `CLOCK_SYNC_KEY` | 服务级同步密钥（`X-Sync-Key`，从 `POST /api/sync/generate-key` 获取） |
| `CLOCK_DEFAULT_USERNAME` | 默认 Clock 用户名 |

## 能力

- 查询用户当前任务列表和优先级
- 查看番茄钟状态（工作中/休息中/空闲/冥想/运动/暂停）
- 读取日程安排（今日课程 Block + 三餐时间）
- 获取今日工作摘要（番茄数、工作分钟、会话列表）
- 列出 Clock 用户（用户名映射）
- 创建/完成任务

> 高效时段、习惯打卡、完成率等统计需用户 token 调用 `/api/stats/*`、`/api/habits/*`，本 skill 暂未封装。

## 工具列表

### 只读工具（走 /api/sync/*，只需用户名 + 可选 CLOCK_SYNC_KEY）

- `clock_get_user_context`: 通过 sync snapshot 一次性获取完整上下文（状态、日程、今日工作）
- `clock_get_timer_status`: 获取番茄钟当前状态
- `clock_get_schedule`: 获取今日日程（课程 Block + 三餐时间）
- `clock_list_users`: 列出所有 Clock 用户（`GET /api/sync/users`）

### 读写工具（需要用户 session token，即 X-Token）

- `clock_get_tasks`: 获取任务列表（`GET /api/tasks?include_archived=bool`）
- `clock_create_task`: 创建新任务（`POST /api/tasks`，字段: name, deadline, pomodor_total, tags, parent_id）
- `clock_complete_task`: 标记任务完成（`PUT /api/tasks/:id`，body `{ status: "completed" }`）

## Sync Snapshot 字段（`GET /api/sync/snapshot?username=`）

| 字段 | 说明 |
|------|------|
| `user_status` | `idle` / `working` / `resting` / `meditating` / `exercising` / `paused` |
| `timer.mode` | `pomodoro` / `exercise` / `meditation` |
| `timer.status` | `idle` / `running` / `paused` |
| `timer.remaining_seconds` | 剩余秒数 |
| `timer.elapsed_overtime_seconds` | 超时秒数 |
| `timer.bath_reminder_due` | 洗澡提醒 |
| `schedule.day_of_week` | 星期几（0=周一） |
| `today_summary.pomodoros_completed` | 今日完成番茄数 |

## 调用时机

Agent 应在以下场景主动调用：

- 用户说"帮我安排XX" → 先查日程再安排
- 用户说"我现在该做什么" → 查任务列表 + 番茄状态
- 用户闲聊时 → 查番茄状态判断是否在工作，调整语气
- 需要确认 Clock 用户名 → 调用 `clock_list_users`

## 行为增强

根据 Clock 上下文调整 Agent 行为：

| 场景 | 检测条件 | 行为 |
|------|---------|------|
| 深度工作 | `user_status` = `working` | 快速简洁回复，不闲聊 |
| 休息中 | `user_status` = `resting` | 可以闲聊，轻松语气 |
| 工作过量 | `today_summary.pomodoros_completed` >= 8 | 主动建议休息 |
| 任务规划 | 用户要求安排 | 结合日程和任务列表推荐 |
