#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib-isolate.sh"

HUB="$SCRIPT_DIR/hub-call.sh"
AGENT_ID="${GSD_CTRL_AGENT_ID:-ctrl}"
POLL_SEC="${GSD_CTRL_POLL_SEC:-10}"
STATE_FILE="${TMPDIR:-/tmp}/gsd2-${GSD_PROJECT_HASH}-${AGENT_ID}-controller-state.json"

export GSD_HUB_PORT
export GSD_PROJECT_HASH
export GSD_PROJECT_DIR

python3 -u - "$HUB" "$AGENT_ID" "$STATE_FILE" "$POLL_SEC" <<'PY'
import json
import os
import subprocess
import sys
import tempfile
import time
from collections import Counter, deque

HUB = sys.argv[1]
AGENT_ID = sys.argv[2]
STATE_FILE = sys.argv[3]
POLL_SEC = max(1.0, float(sys.argv[4]))

TOPICS = {"ctrl.inbox", "ctrl.quality"}
VALID_STAGES = {"discuss", "research", "plan", "execute", "verify"}


def now_ts() -> float:
    return time.time()


def iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def log(message: str) -> None:
    print(f"[{iso_now()}] [{AGENT_ID}] {message}", flush=True)


def default_state() -> dict:
    return {
        "cursor": None,
        "handled_event_ids": [],
        "phases": {},
    }


def parse_json_text(text: str):
    body = (text or "").strip()
    if not body:
        return None
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return None


def load_state() -> dict:
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, dict):
            raise ValueError("state_not_dict")
    except Exception:
        data = default_state()
    data.setdefault("cursor", None)
    data.setdefault("handled_event_ids", [])
    data.setdefault("phases", {})
    return data


def save_state() -> None:
    state["handled_event_ids"] = state.get("handled_event_ids", [])[-500:]
    directory = os.path.dirname(STATE_FILE)
    if directory:
        os.makedirs(directory, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        prefix=os.path.basename(STATE_FILE) + ".",
        dir=directory or None,
        text=True,
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(state, handle, ensure_ascii=False, indent=2, sort_keys=True)
        os.replace(tmp_path, STATE_FILE)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def hub(tool: str, args: dict) -> dict:
    payload = json.dumps(args, ensure_ascii=False, separators=(",", ":"))
    last_error = {"ok": False, "tool": tool, "error": "unknown"}
    for attempt in range(1, 4):
        try:
            result = subprocess.run(
                [HUB, AGENT_ID, tool, payload],
                capture_output=True,
                text=True,
                timeout=150,
                env=os.environ.copy(),
            )
        except subprocess.TimeoutExpired:
            last_error = {"ok": False, "tool": tool, "error": "timeout"}
        else:
            stdout = (result.stdout or "").strip()
            stderr = (result.stderr or "").strip()
            if result.returncode == 0:
                data = parse_json_text(stdout)
                if isinstance(data, dict):
                    return data
                last_error = {
                    "ok": False,
                    "tool": tool,
                    "error": "invalid_json",
                    "raw": stdout[:800],
                }
            else:
                data = parse_json_text(stdout) or parse_json_text(stderr)
                if isinstance(data, dict):
                    data.setdefault("ok", False)
                    data["tool"] = tool
                    last_error = data
                else:
                    last_error = {
                        "ok": False,
                        "tool": tool,
                        "error": stderr[:800] or stdout[:800] or f"returncode_{result.returncode}",
                    }
        log(f"{tool} failed attempt={attempt} error={last_error.get('error')}")
        time.sleep(5 if attempt < 3 else 30)
    return last_error


def short_text(value, limit: int = 120) -> str:
    text = " ".join(str(value).split())
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 3)] + "..."


def canon_text(value) -> str:
    return " ".join(str(value).split()).strip().lower()


def listify(value) -> list[str]:
    if value is None:
        return []
    items = value if isinstance(value, list) else [value]
    out: list[str] = []
    for item in items:
        text = " ".join(str(item).split())
        if text:
            out.append(text)
    return out


def normalize_stage(value) -> str:
    text = str(value or "").strip()
    return text if text in VALID_STAGES else "execute"


def conceptual_to_hub_priority(value) -> int:
    try:
        rank = int(value)
    except Exception:
        rank = 50
    rank = max(1, min(100, rank))
    return 101 - rank


def ensure_registered() -> None:
    while True:
        registered = hub("hub_register", {"agent_id": AGENT_ID})
        if registered.get("ok"):
            log("hub_register")
            break
        time.sleep(30)

    assigned = hub("hub_assign_role", {"agent_id": AGENT_ID, "role": "controller"})
    if assigned.get("ok"):
        log("hub_assign_role")

    subscribed = hub("hub_subscribe", {"agent_id": AGENT_ID, "topics": sorted(TOPICS)})
    if subscribed.get("ok"):
        log("hub_subscribe")

    heartbeat = hub("hub_heartbeat_role", {"agent_id": AGENT_ID})
    if heartbeat.get("ok"):
        log("heartbeat_ready")


def normalize_requirement(requirement, idx: int, phase_label) -> dict:
    default_priority_rank = min(100, 10 + idx * 5)
    if isinstance(requirement, dict):
        raw_summary = short_text(
            requirement.get("requirement")
            or requirement.get("summary")
            or requirement.get("description")
            or requirement.get("goal")
            or requirement.get("title")
            or json.dumps(requirement, ensure_ascii=False),
            240,
        )
        title = short_text(
            requirement.get("title")
            or requirement.get("summary")
            or requirement.get("requirement")
            or requirement.get("goal")
            or f"Phase {phase_label} requirement {idx + 1}",
            120,
        )
        files = listify(
            requirement.get("files")
            or requirement.get("paths")
            or requirement.get("file_paths")
            or requirement.get("touched_files")
        )
        behavior = short_text(
            requirement.get("expected_behavior")
            or requirement.get("behavior")
            or requirement.get("expected")
            or raw_summary,
            320,
        )
        acceptance = short_text(
            requirement.get("acceptance")
            or requirement.get("acceptance_criteria")
            or requirement.get("done_when")
            or requirement.get("verification")
            or "",
            320,
        )
        stage = normalize_stage(requirement.get("workflow_stage") or requirement.get("stage"))
        conceptual_priority = requirement.get("priority", default_priority_rank)
        module = requirement.get("module") or requirement.get("area")
        depends_refs = listify(
            requirement.get("depends_on")
            or requirement.get("dependencies")
            or requirement.get("after")
        )
        key = str(requirement.get("key") or requirement.get("id") or f"req-{idx + 1}")
    else:
        raw_summary = short_text(requirement or f"Requirement {idx + 1}", 240)
        title = short_text(f"Phase {phase_label} requirement {idx + 1}: {raw_summary}", 120)
        files = []
        behavior = raw_summary
        acceptance = ""
        stage = "execute"
        conceptual_priority = default_priority_rank
        module = None
        depends_refs = []
        key = f"req-{idx + 1}"

    description_lines = [
        f"Requirement source: {raw_summary}",
        "Files to modify/create: "
        + (
            ", ".join(files)
            if files
            else "Identify the exact file paths in the relevant module before editing, then include those paths in the implementation notes and result summary."
        ),
        f"Expected behavior change: {behavior}",
        "Acceptance criteria: "
        + (
            acceptance
            or "Implement the requirement, verify the affected flow or tests as appropriate, and report the touched files plus observed outcome in the task result."
        ),
    ]

    return {
        "index": idx,
        "key": key,
        "title": title,
        "description": "\n".join(description_lines),
        "workflow_stage": stage,
        "hub_priority": conceptual_to_hub_priority(conceptual_priority),
        "module": str(module) if module else None,
        "depends_refs": depends_refs,
        "dep_indices": [],
        "ignored_dep_refs": [],
    }


def resolve_dep_index(ref, item_count: int, key_map: dict, title_map: dict):
    if isinstance(ref, int):
        if 1 <= ref <= item_count:
            return ref - 1
        if 0 <= ref < item_count:
            return ref
        return None

    text = str(ref).strip()
    if not text:
        return None

    if text.isdigit():
        idx = int(text)
        if 1 <= idx <= item_count:
            return idx - 1
        if 0 <= idx < item_count:
            return idx

    key = canon_text(text)
    if key in key_map:
        return key_map[key]
    if key in title_map:
        return title_map[key]
    return None


def topo_order(items: list[dict]) -> list[int]:
    graph = {item["index"]: set() for item in items}
    indegree = {item["index"]: 0 for item in items}

    for item in items:
        child = item["index"]
        for dep_idx in item.get("dep_indices", []):
            if dep_idx == child or child in graph[dep_idx]:
                continue
            graph[dep_idx].add(child)
            indegree[child] += 1

    queue = deque([idx for idx in sorted(indegree) if indegree[idx] == 0])
    order: list[int] = []

    while queue:
        current = queue.popleft()
        order.append(current)
        for child in sorted(graph[current]):
            indegree[child] -= 1
            if indegree[child] == 0:
                queue.append(child)

    if len(order) < len(items):
        seen = set(order)
        order.extend([item["index"] for item in items if item["index"] not in seen])
    return order


def create_phase_tasks(event: dict) -> None:
    event_id = str(event.get("id") or "")
    if not event_id or event_id in state["handled_event_ids"]:
        return

    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    phase_label = payload.get("phase", f"event-{event_id}")
    goal = short_text(payload.get("goal") or payload.get("description") or "", 240)
    requirements = payload.get("requirements")
    if not isinstance(requirements, list) or not requirements:
        seed = payload.get("goal") or payload.get("description") or "Investigate the phase objective and create the required implementation tasks."
        requirements = [seed]

    items = [normalize_requirement(req, idx, phase_label) for idx, req in enumerate(requirements)]
    key_map: dict[str, int] = {}
    title_map: dict[str, int] = {}

    for item in items:
        key_map[canon_text(item["key"])] = item["index"]
        title_map[canon_text(item["title"])] = item["index"]
        key_map[str(item["index"] + 1)] = item["index"]

    for item in items:
        seen: set[int] = set()
        for ref in item.get("depends_refs", []):
            dep_idx = resolve_dep_index(ref, len(items), key_map, title_map)
            if dep_idx is None or dep_idx == item["index"] or dep_idx in seen:
                item["ignored_dep_refs"].append(str(ref))
                continue
            item["dep_indices"].append(dep_idx)
            seen.add(dep_idx)

    order = topo_order(items)
    created_ids: dict[int, str] = {}
    task_ids: list[str] = []
    task_titles: dict[str, str] = {}

    log(f"phase_objective phase={phase_label} requirements={len(items)}")

    for idx in order:
        item = items[idx]
        create_args = {
            "creator_agent_id": AGENT_ID,
            "title": item["title"],
            "description": item["description"],
            "workflow_stage": item["workflow_stage"],
            "priority": item["hub_priority"],
            "idempotency_key": f"ctrl:{event_id}:{idx + 1}",
        }

        dep_ids = [created_ids[dep_idx] for dep_idx in item.get("dep_indices", []) if dep_idx in created_ids]
        if dep_ids:
            create_args["depends_on"] = dep_ids
        if item.get("module"):
            create_args["module"] = item["module"]
        if item.get("ignored_dep_refs"):
            create_args["description"] += "\nUnresolved dependency hints ignored: " + ", ".join(item["ignored_dep_refs"])

        created = hub("hub_create_task", create_args)
        task = created.get("task") if isinstance(created, dict) else None
        task_id = task.get("id") if isinstance(task, dict) else None
        if not task_id:
            log(f"hub_create_task missing_task_id phase={phase_label} item={idx + 1}")
            continue
        created_ids[idx] = task_id
        task_ids.append(task_id)
        task_titles[task_id] = item["title"]
        log(f"created task phase={phase_label} idx={idx + 1} task_id={task_id}")
        time.sleep(0.2)

    state["handled_event_ids"].append(event_id)
    state["phases"][event_id] = {
        "phase": phase_label,
        "goal": goal,
        "event_id": event_id,
        "display_name": f"phase {phase_label}",
        "task_ids": task_ids,
        "task_titles": task_titles,
        "completion_reported": False,
        "created_at": now_ts(),
        "last_done_count": 0,
        "last_done_change_ts": now_ts(),
    }
    save_state()

    hub(
        "hub_publish",
        {
            "agent_id": AGENT_ID,
            "topic": "proxy.inbox",
            "payload": {
                "type": "tasks_created",
                "count": len(task_ids),
                "phase": phase_label,
            },
        },
    )


def create_quality_followup(event: dict) -> None:
    event_id = str(event.get("id") or "")
    if not event_id or event_id in state["handled_event_ids"]:
        return

    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    details = short_text(
        payload.get("details")
        or payload.get("summary")
        or payload.get("issue")
        or payload.get("message")
        or json.dumps(payload, ensure_ascii=False),
        240,
    )
    file_path = short_text(payload.get("file") or payload.get("path") or "unspecified", 200)
    title = short_text(payload.get("title") or f"Quality follow-up: {details}", 120)
    entry_key = f"quality:{event_id}"

    created = hub(
        "hub_create_task",
        {
            "creator_agent_id": AGENT_ID,
            "title": title,
            "description": "\n".join(
                [
                    f"Quality issue source: {details}",
                    f"Files to inspect first: {file_path}",
                    "Expected behavior change: address the reported quality issue without regressing the active phase.",
                    "Acceptance criteria: the issue is fixed or triaged with concrete evidence, and the task result references the touched files plus validation outcome.",
                ]
            ),
            "workflow_stage": normalize_stage(payload.get("workflow_stage") or "verify"),
            "priority": conceptual_to_hub_priority(payload.get("priority", 5)),
            "idempotency_key": f"ctrl:quality:{event_id}",
        },
    )

    task = created.get("task") if isinstance(created, dict) else None
    task_id = task.get("id") if isinstance(task, dict) else None
    state["handled_event_ids"].append(event_id)
    state["phases"][entry_key] = {
        "phase": payload.get("phase", "quality"),
        "goal": details,
        "event_id": event_id,
        "display_name": f"quality {short_text(details, 48)}",
        "task_ids": [task_id] if task_id else [],
        "task_titles": {task_id: title} if task_id else {},
        "completion_reported": False,
        "created_at": now_ts(),
        "last_done_count": 0,
        "last_done_change_ts": now_ts(),
    }
    save_state()

    log(f"quality_followup event={event_id} task_id={task_id or 'missing'}")


def process_event(event: dict) -> None:
    if not isinstance(event, dict):
        return

    event_id = str(event.get("id") or "")
    if not event_id or event_id in state["handled_event_ids"]:
        return

    topic = event.get("topic")
    if topic not in TOPICS:
        return

    if event.get("agent_id") == AGENT_ID:
        state["handled_event_ids"].append(event_id)
        save_state()
        return

    payload = event.get("payload")
    if not isinstance(payload, dict):
        state["handled_event_ids"].append(event_id)
        save_state()
        return

    event_type = payload.get("type")

    if topic == "ctrl.inbox" and event_type == "phase_objective":
        create_phase_tasks(event)
        return

    if topic == "ctrl.quality" or event_type in {"quality_issue", "task_failed", "worker_failed"}:
        create_quality_followup(event)
        return

    state["handled_event_ids"].append(event_id)
    save_state()


def task_status_counts(task_ids: list[str], tasks_by_id: dict) -> tuple[Counter, list[str]]:
    counts: Counter = Counter()
    missing: list[str] = []
    for task_id in task_ids:
        task = tasks_by_id.get(task_id)
        if not task:
            missing.append(task_id)
            continue
        counts[str(task.get("status") or "unknown")] += 1
    return counts, missing


def publish_progress(summary: str) -> None:
    hub(
        "hub_publish",
        {
            "agent_id": AGENT_ID,
            "topic": "proxy.inbox",
            "payload": {
                "type": "progress_report",
                "from": AGENT_ID,
                "summary": summary,
            },
        },
    )


def monitor_and_report() -> None:
    listed = hub("hub_list_tasks", {"limit": 500})
    tasks = listed.get("tasks") if isinstance(listed.get("tasks"), list) else []
    tasks_by_id = {
        task.get("id"): task
        for task in tasks
        if isinstance(task, dict) and task.get("id")
    }
    overall = Counter(str(task.get("status") or "unknown") for task in tasks_by_id.values())
    now = now_ts()

    summaries: list[str] = []
    stalled: list[str] = []

    for phase in sorted(state.get("phases", {}).values(), key=lambda item: item.get("created_at", 0)):
        task_ids = phase.get("task_ids") or []
        if not task_ids:
            continue

        counts, missing = task_status_counts(task_ids, tasks_by_id)
        total = len(task_ids)
        done = counts.get("done", 0)
        claimed = counts.get("claimed", 0)
        open_count = counts.get("open", 0)
        blocked = counts.get("blocked", 0)
        cancelled = counts.get("cancelled", 0)

        if done > phase.get("last_done_count", 0):
            phase["last_done_count"] = done
            phase["last_done_change_ts"] = now

        display_name = phase.get("display_name") or f"phase {phase.get('phase')}"
        summary = f"{display_name}: {done}/{total} done, {claimed} claimed, {open_count} open"
        if blocked:
            summary += f", {blocked} blocked"
        if cancelled:
            summary += f", {cancelled} cancelled"
        if missing:
            summary += f", {len(missing)} missing_from_list"
        summaries.append(short_text(summary, 180))

        if total and done < total and now - phase.get("last_done_change_ts", now) > 300:
            stalled.append(display_name)

        if total and done == total and not phase.get("completion_reported"):
            task_names = list((phase.get("task_titles") or {}).values())
            completion = f"All {total} tasks are done for phase {phase.get('phase')}."
            if phase.get("goal"):
                completion += f" Goal: {phase['goal']}."
            if task_names:
                completion += f" Tasks: {'; '.join(task_names[:4])}."
            hub(
                "hub_publish",
                {
                    "agent_id": AGENT_ID,
                    "topic": "proxy.inbox",
                    "payload": {
                        "type": "phase_complete",
                        "phase": phase.get("phase"),
                        "summary": completion,
                    },
                },
            )
            phase["completion_reported"] = True
            phase["completed_at"] = now
            log(f"phase_complete phase={phase.get('phase')} total={total}")

    if summaries:
        summary = " | ".join(summaries[:3])
        if len(summaries) > 3:
            summary += f" | +{len(summaries) - 3} more"
    else:
        summary = "idle; no tracked phase tasks"

    summary += f"; tasks_by_status={dict(sorted(overall.items()))}"
    if stalled:
        summary += f"; stalled={', '.join(stalled[:3])}"

    publish_progress(summary)
    save_state()
    log(f"monitor tasks_by_status={dict(sorted(overall.items()))}")


state = load_state()
ensure_registered()

while True:
    poll_args = {"agent_id": AGENT_ID, "limit": 100}
    if state.get("cursor"):
        poll_args["after_event_id"] = state["cursor"]

    polled = hub("hub_poll_events", poll_args)
    if not polled.get("ok"):
        ensure_registered()
        time.sleep(min(POLL_SEC, 5.0))
        continue

    next_cursor = polled.get("cursor")
    events = polled.get("events") if isinstance(polled.get("events"), list) else []
    for event in events:
        process_event(event)

    if next_cursor:
        state["cursor"] = next_cursor
    save_state()

    monitor_and_report()

    heartbeat = hub("hub_heartbeat_role", {"agent_id": AGENT_ID})
    if not heartbeat.get("ok"):
        log("heartbeat_failed_re_registering")
        ensure_registered()

    time.sleep(POLL_SEC)
PY
