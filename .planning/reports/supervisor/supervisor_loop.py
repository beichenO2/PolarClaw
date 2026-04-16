#!/usr/bin/env python3
from __future__ import annotations
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

# MyClaw repo root: this file is at <repo>/.planning/reports/supervisor/supervisor_loop.py
_DEFAULT_MYCLAW_ROOT = Path(__file__).resolve().parent.parent.parent.parent
PROJECT_ROOT = Path(os.environ.get("MYCLAW_ROOT", _DEFAULT_MYCLAW_ROOT))

_POLARISOR_ROOT = Path(os.environ.get("POLARISOR_ROOT", str(PROJECT_ROOT.parent)))
_HUB_REL = Path("gsd-2") / "scripts" / "hub-call.sh"
HUB = Path(os.environ.get("MYCLAW_HUB_CALL_SCRIPT", str(_POLARISOR_ROOT / _HUB_REL)))

DB_PATH = Path(os.environ.get("MYCLAW_HUB_DB", str(PROJECT_ROOT / ".planning" / "hub" / "hub.sqlite")))
REPORT_DIR = PROJECT_ROOT / ".planning/reports/supervisor"
STATE_PATH = Path(
    os.environ.get("MYCLAW_SUPERVISOR_STATE", "/tmp/gsd2-bae4-supervisor-state.json"),
)
AGENT_ID = os.environ.get("MYCLAW_SUPERVISOR_AGENT_ID", "super")
POLL_SECONDS = int(os.environ.get("MYCLAW_SUPERVISOR_POLL_SECONDS", "15"))
MAX_REVIEWS_PER_LOOP = int(os.environ.get("MYCLAW_SUPERVISOR_MAX_REVIEWS", "12"))

SECRET_PATTERNS = [
    ("private key", re.compile(r"-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----")),
    ("api key literal", re.compile(r"""(?:api[_-]?key|apikey)\s*[=:]\s*["'][A-Za-z0-9_-]{20,}["']""", re.I)),
    ("generic secret literal", re.compile(r"""(?:secret|password|passwd|token)\s*[=:]\s*["'][A-Za-z0-9_\-!@#$%^&*]{8,}["']""", re.I)),
    ("bearer token literal", re.compile(r"Bearer\s+[A-Za-z0-9_\-.]{20,}")),
    ("DashScope key", re.compile(r"sk-[a-z0-9]{32,}", re.I)),
]
TODO_RE = re.compile(r"\b(TODO|FIXME|XXX)\b")
FILE_RE = re.compile(r"((?:apps|packages|gsd-2|src|test|tests)/[A-Za-z0-9@_./\-]+(?:\.[A-Za-z0-9._-]+)?)")
REQ_RE = re.compile(r"REQ-[A-Z]\d+")
CODE_EXTS = {".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".sh"}
SKIP_DIRS = {"node_modules", ".git", "dist", "build", "coverage", ".next", ".cursor-cache"}
SEARCH_ROOT_HINTS = ("apps", "packages", "src", "test", "tests", "scripts")


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(message: str) -> None:
    print(f"[{now_iso()}] {message}", flush=True)


def load_state() -> dict:
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        return {
            "reviewed_tasks": data.get("reviewed_tasks", {}),
            "published_issue_keys": data.get("published_issue_keys", []),
        }
    except Exception:
        return {"reviewed_tasks": {}, "published_issue_keys": []}


def save_state(state: dict) -> None:
    tmp_path = STATE_PATH.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.replace(STATE_PATH)


def hub_env() -> dict[str, str]:
    """Env for hub-call subprocess; does not overwrite vars already set in the shell."""
    env = {k: str(v) for k, v in os.environ.items()}
    env.setdefault("GSD_HUB_PORT", env.get("MYCLAW_GSD_HUB_PORT", "57844"))
    env.setdefault("GSD_PROJECT_HASH", env.get("MYCLAW_GSD_PROJECT_HASH", "bae4"))
    return env


def hub(tool_name: str, args: dict, timeout: int = 120) -> dict:
    result = subprocess.run(
        [str(HUB), AGENT_ID, tool_name, json.dumps(args, ensure_ascii=False)],
        cwd=str(PROJECT_ROOT),
        env=hub_env(),
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    stdout = (result.stdout or "").strip()
    stderr = (result.stderr or "").strip()
    if result.returncode != 0:
        raise RuntimeError(stderr or stdout or f"hub call failed: {tool_name}")
    return json.loads(stdout) if stdout else {}


def ensure_registered() -> None:
    while True:
        try:
            response = hub("hub_register", {"agent_id": AGENT_ID})
            role = ((response.get("assigned_role") or {}).get("role")) or "unknown"
            log(f"hub_register ok role={role}")
            return
        except Exception as exc:
            log(f"hub_register failed: {exc}")
            time.sleep(5)


def heartbeat() -> None:
    try:
        response = hub("hub_heartbeat_role", {"agent_id": AGENT_ID})
        log(f"heartbeat ok={response.get('ok')}")
    except Exception as exc:
        log(f"heartbeat failed: {exc}; re-registering")
        ensure_registered()


def task_details(task_id: str) -> dict | None:
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            "select id, title, description, module, status, workflow_stage, updated_at from tasks where id = ?",
            (task_id,),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def clean_rel(path_text: str) -> str | None:
    candidate = path_text.rstrip(".,;:)")
    absolute = (PROJECT_ROOT / candidate).resolve()
    try:
        absolute.relative_to(PROJECT_ROOT.resolve())
    except Exception:
        return None
    if absolute.is_file():
        return str(absolute.relative_to(PROJECT_ROOT))
    return None


def extract_paths(text: str) -> list[str]:
    found: list[str] = []
    for match in FILE_RE.findall(text or ""):
        rel = clean_rel(match)
        if rel and rel not in found:
            found.append(rel)
    return found


def module_roots(module: str | None) -> list[Path]:
    roots: list[Path] = []
    if not module:
        return roots
    normalized = module.strip().lower()
    direct_candidates = [f"apps/{module}", f"packages/{module}", module]
    if normalized in {"test", "tests"}:
        direct_candidates.extend(["test", "tests"])
    for rel in direct_candidates:
        path = PROJECT_ROOT / rel
        if path.is_dir() and path not in roots:
            roots.append(path)
    if roots:
        return roots[:3]
    for base in (PROJECT_ROOT / "apps", PROJECT_ROOT / "packages"):
        if not base.is_dir():
            continue
        for child in base.iterdir():
            if child.is_dir() and module.lower() in child.name.lower() and child not in roots:
                roots.append(child)
    return roots[:3]


def keyword_search_roots(task: dict) -> list[Path]:
    roots: list[Path] = []
    module = (task.get("module") or "").strip().lower()
    module_first = module not in {"test", "tests"}
    if module_first:
        for root in module_roots(task.get("module")):
            if root not in roots:
                roots.append(root)
    for rel in SEARCH_ROOT_HINTS:
        path = PROJECT_ROOT / rel
        if path.is_dir() and path not in roots:
            roots.append(path)
    if not module_first:
        for root in module_roots(task.get("module")):
            if root not in roots:
                roots.append(root)
    return roots or [PROJECT_ROOT]


def list_code_files(root: Path, limit: int = 12) -> list[Path]:
    output: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if name not in SKIP_DIRS]
        for filename in sorted(filenames):
            path = Path(dirpath) / filename
            if path.suffix in CODE_EXTS:
                output.append(path)
                if len(output) >= limit:
                    return output
    return output


def list_test_files(root: Path, limit: int = 20) -> list[Path]:
    output: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if name not in SKIP_DIRS]
        for filename in sorted(filenames):
            lower = filename.lower()
            if ".test." in lower or ".spec." in lower:
                output.append(Path(dirpath) / filename)
                if len(output) >= limit:
                    return output
    return output


def keyword_scan(roots: list[Path], keywords: list[str], limit: int) -> list[str]:
    matches: list[str] = []
    lowered_keywords = [keyword.lower() for keyword in keywords if keyword]
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [name for name in dirnames if name not in SKIP_DIRS]
            for filename in sorted(filenames):
                path = Path(dirpath) / filename
                if path.suffix not in CODE_EXTS:
                    continue
                try:
                    rel = str(path.resolve().relative_to(PROJECT_ROOT.resolve()))
                except Exception:
                    continue
                haystack = rel.lower()
                if any(keyword in haystack for keyword in lowered_keywords):
                    if rel not in matches:
                        matches.append(rel)
                        if len(matches) >= limit:
                            return matches
                    continue
                try:
                    text = path.read_text(encoding="utf-8", errors="ignore").lower()
                except Exception:
                    continue
                if any(keyword in text for keyword in lowered_keywords):
                    if rel not in matches:
                        matches.append(rel)
                        if len(matches) >= limit:
                            return matches
    return matches


def search_by_keywords(task: dict, limit: int = 8) -> list[str]:
    keywords: list[str] = []
    for text in (task.get("title") or "", task.get("description") or ""):
        for req in REQ_RE.findall(text):
            if req not in keywords:
                keywords.append(req)
    if not keywords:
        stopwords = {"phase", "guard", "hook", "public", "private", "report", "task", "quality", "follow", "issue", "review", "full", "validate"}
        for text in (task.get("title") or "", task.get("description") or ""):
            for token in re.findall(r"[A-Za-z][A-Za-z0-9_-]{4,}", text):
                lowered = token.lower()
                if lowered not in stopwords and token not in keywords:
                    keywords.append(token)
                if len(keywords) >= 3:
                    break
            if len(keywords) >= 3:
                break

    matches: list[str] = []
    roots = keyword_search_roots(task)
    rg_path = shutil.which("rg")
    candidate_keywords = keywords[:3]
    for keyword in candidate_keywords:
        if not rg_path:
            break
        try:
            proc = subprocess.run(
                [rg_path, "-l", "-F", keyword, *[str(root) for root in roots]],
                capture_output=True,
                text=True,
                timeout=20,
            )
        except Exception:
            proc = None
        if not proc:
            break
        for line in proc.stdout.splitlines():
            path = Path(line.strip())
            if path.is_file() and path.suffix in CODE_EXTS:
                rel = str(path.resolve().relative_to(PROJECT_ROOT.resolve()))
                if rel not in matches:
                    matches.append(rel)
                    if len(matches) >= limit:
                        return matches
    if len(matches) < limit:
        for rel in keyword_scan(roots, candidate_keywords, limit):
            if rel not in matches:
                matches.append(rel)
                if len(matches) >= limit:
                    break
    return matches


def gather_files(task: dict) -> tuple[list[str], list[Path]]:
    files: list[str] = []
    for text in (task.get("title") or "", task.get("description") or ""):
        for rel in extract_paths(text):
            if rel not in files:
                files.append(rel)

    roots: list[Path] = []
    for rel in list(files):
        parts = Path(rel).parts
        if len(parts) >= 2 and parts[0] in {"apps", "packages"}:
            root = PROJECT_ROOT / parts[0] / parts[1]
            if root.is_dir() and root not in roots:
                roots.append(root)

    for root in module_roots(task.get("module")):
        if root not in roots:
            roots.append(root)

    has_code_file = any(
        (PROJECT_ROOT / rel).suffix in CODE_EXTS and ".test." not in rel.lower() and ".spec." not in rel.lower()
        for rel in files
    )
    if not files or not has_code_file:
        for rel in search_by_keywords(task):
            if rel not in files:
                files.append(rel)

    for root in roots:
        for test_file in list_test_files(root, limit=4):
            rel = str(test_file.resolve().relative_to(PROJECT_ROOT.resolve()))
            if rel not in files:
                files.append(rel)
        has_code_file = any(
            (PROJECT_ROOT / rel).suffix in CODE_EXTS and ".test." not in rel.lower() and ".spec." not in rel.lower()
            for rel in files
        )
        if not has_code_file:
            for code_file in list_code_files(root, limit=4):
                rel = str(code_file.resolve().relative_to(PROJECT_ROOT.resolve()))
                if rel not in files:
                    files.append(rel)

    return files[:12], roots


def read_text(rel_path: str, limit: int = 120000) -> str:
    try:
        data = (PROJECT_ROOT / rel_path).read_text(encoding="utf-8", errors="ignore")
        return data[:limit]
    except Exception:
        return ""


def issue_key(task_id: str, updated_at: int | None, file_path: str, message: str) -> str:
    base = f"{task_id}|{updated_at}|{file_path}|{message}"
    return hashlib.sha1(base.encode("utf-8")).hexdigest()


def dedupe_issues(raw_issues: list[dict]) -> list[dict]:
    seen: set[tuple[str, str, str]] = set()
    output: list[dict] = []
    for item in raw_issues:
        key = (item["severity"], item["file"], item["message"])
        if key in seen:
            continue
        seen.add(key)
        output.append(item)
    return output


def review_task(task: dict) -> tuple[list[dict], list[str]]:
    files, _roots = gather_files(task)
    issues: list[dict] = []
    test_text = "\n".join(read_text(rel) for rel in files if ".test." in rel.lower() or ".spec." in rel.lower())
    code_files = [
        rel
        for rel in files
        if (PROJECT_ROOT / rel).suffix in CODE_EXTS and ".test." not in rel.lower() and ".spec." not in rel.lower()
    ]

    for rel in code_files:
        text = read_text(rel)
        if not text:
            continue

        for idx, line in enumerate(text.splitlines(), start=1):
            if TODO_RE.search(line):
                issues.append(
                    {
                        "severity": "WARN",
                        "file": rel,
                        "message": f"completed task still contains TODO/FIXME at line {idx}",
                    }
                )
            for name, pattern in SECRET_PATTERNS:
                if pattern.search(line):
                    issues.append(
                        {
                            "severity": "CRITICAL",
                            "file": rel,
                            "message": f"possible hard-coded {name} at line {idx}",
                        }
                    )

        if re.search(r"catch\s*\([^)]*\)\s*\{\s*\}", text, re.S):
            issues.append(
                {
                    "severity": "WARN",
                    "file": rel,
                    "message": "empty catch block may swallow errors",
                }
            )
        if re.search(r"except\s*:\s*pass", text):
            issues.append(
                {
                    "severity": "WARN",
                    "file": rel,
                    "message": "bare except with pass may swallow errors",
                }
            )
        if rel.endswith("git-guardian.mjs"):
            if 'REMOTE="$1"' in text and "github.com" in text:
                issues.append(
                    {
                        "severity": "CRITICAL",
                        "file": rel,
                        "message": "pre-push hook checks GitHub URL via $1, but Git passes remote name as arg1 and remote URL as arg2; public-repo blocking can be bypassed",
                    }
                )
            if 'RANGE="$3"' in text:
                issues.append(
                    {
                        "severity": "CRITICAL",
                        "file": rel,
                        "message": "pre-push hook reads $3 as RANGE, but pre-push only provides two args and refs arrive on stdin; secret scan path is incorrect",
                    }
                )
            if "installPrePushHook" in text and "installPrePushHook" not in test_text and "prePushGuard" not in test_text:
                issues.append(
                    {
                        "severity": "WARN",
                        "file": rel,
                        "message": "security tests do not directly exercise installPrePushHook/prePushGuard regression paths",
                    }
                )

    if code_files and not any(".test." in rel.lower() or ".spec." in rel.lower() for rel in files):
        issues.append(
            {
                "severity": "WARN",
                "file": code_files[0],
                "message": "no nearby test files were found for the reviewed code scope",
            }
        )

    return dedupe_issues(issues), files


def write_report(task: dict, files: list[str], issues: list[dict]) -> Path:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = REPORT_DIR / f"{stamp}-{task['id']}-audit.md"
    lines = [
        f"# Supervisor audit - {stamp}",
        "",
        "## Reviewed",
        "",
        f"- Task: `{task['id']}`",
        f"- Title: {task.get('title') or '(untitled)'}",
        f"- Module: `{task.get('module') or 'n/a'}`",
        f"- Stage: `{task.get('workflow_stage') or 'n/a'}`",
        f"- Files: {', '.join(f'`{item}`' for item in files) if files else '(no resolved files)'}",
        "",
        "## Findings",
        "",
    ]
    if issues:
        for issue in issues:
            lines.append(f"- [{issue['severity']}] `{issue['file']}` - {issue['message']}")
    elif not files:
        lines.append("- Review scope was limited because no related files could be resolved from task metadata.")
    else:
        lines.append("- No obvious quality issue found in the reviewed scope.")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def publish_issue(task: dict, issue: dict, state: dict) -> None:
    if issue.get("severity") not in {"CRITICAL", "WARN"}:
        return
    key = issue_key(task["id"], task.get("updated_at"), issue["file"], issue["message"])
    if key in state["published_issue_keys"]:
        return
    payload = {
        "agent_id": AGENT_ID,
        "topic": "ctrl.inbox",
        "payload": {
            "type": "quality_issue",
            "details": f"[{issue['severity']}] review of task {task['id']} ({task.get('title') or task.get('module') or 'untitled'}) found: {issue['message']}",
            "file": issue["file"],
        },
    }
    try:
        response = hub("hub_publish", payload)
        log(f"published issue for {task['id']} file={issue['file']} dedup={response.get('deduplicated')}")
        state["published_issue_keys"].append(key)
        state["published_issue_keys"] = state["published_issue_keys"][-500:]
    except Exception as exc:
        log(f"publish issue failed for {task['id']}: {exc}")


def publish_all_clear(task: dict, files: list[str]) -> None:
    payload = {
        "agent_id": AGENT_ID,
        "topic": "proxy.inbox",
        "payload": {
            "type": "quality_report",
            "from": AGENT_ID,
            "status": "all_clear",
            "details": f"reviewed task {task['id']} with no obvious issue in {', '.join(files[:4]) if files else (task.get('module') or 'resolved scope')}",
        },
    }
    try:
        response = hub("hub_publish", payload)
        log(f"published all_clear for {task['id']} dedup={response.get('deduplicated')}")
    except Exception as exc:
        log(f"publish all_clear failed for {task['id']}: {exc}")


def loop() -> None:
    ensure_registered()
    state = load_state()
    log("supervisor loop started")
    while True:
        try:
            listed = hub("hub_list_tasks", {"status": "done", "limit": 100})
            tasks = listed.get("tasks", []) if isinstance(listed, dict) else []
            reviewed_now = 0

            for task_stub in tasks:
                if reviewed_now >= MAX_REVIEWS_PER_LOOP:
                    log(f"reached per-loop review cap ({MAX_REVIEWS_PER_LOOP}); remaining backlog will be reviewed in later cycles")
                    break
                detail = task_details(task_stub.get("id")) or dict(task_stub)
                updated_at = int(detail.get("updated_at") or 0)
                last_reviewed = int(state["reviewed_tasks"].get(detail["id"], 0) or 0)
                if updated_at and last_reviewed >= updated_at:
                    continue

                issues, files = review_task(detail)
                report = write_report(detail, files, issues)
                log(f"reviewed {detail['id']} files={len(files)} issues={len(issues)} report={report}")

                if issues:
                    for issue in issues:
                        publish_issue(detail, issue, state)
                elif files:
                    publish_all_clear(detail, files)
                else:
                    log(f"skipped publish for {detail['id']} because no related files were resolved")

                state["reviewed_tasks"][detail["id"]] = updated_at or int(time.time() * 1000)
                save_state(state)
                reviewed_now += 1

            if reviewed_now == 0:
                log("no new done tasks")

            heartbeat()
            time.sleep(POLL_SECONDS)
        except Exception as exc:
            log(f"loop error: {exc}")
            traceback.print_exc()
            time.sleep(5)
            ensure_registered()


if __name__ == "__main__":
    loop()
