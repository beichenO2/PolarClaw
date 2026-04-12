import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";

const SECRET_PATTERNS = [
  { name: "AWS Access Key", pattern: /(?:^|[^A-Za-z0-9])AKIA[0-9A-Z]{16}(?:[^A-Za-z0-9]|$)/ },
  { name: "AWS Secret Key", pattern: /aws_secret_access_key\s*[=:]\s*\S{20,}/ },
  { name: "Private Key Header", pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/ },
  { name: "Generic API Key", pattern: /(?:api[_-]?key|apikey)\s*[=:]\s*["']?[A-Za-z0-9_\-]{20,}["']?/i },
  { name: "Generic Secret", pattern: /(?:secret|password|passwd|token)\s*[=:]\s*["']?[A-Za-z0-9_\-!@#$%^&*]{8,}["']?/i },
  { name: "GitHub Token", pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
  { name: "Slack Token", pattern: /xox[bpras]-[0-9]{10,}-[A-Za-z0-9-]+/ },
  { name: "Bearer Token Literal", pattern: /Bearer\s+[A-Za-z0-9_\-.]{20,}/ },
  { name: "Connection String", pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^\s"']{10,}/ },
  { name: "DashScope Key", pattern: /sk-[a-z0-9]{32,}/i },
];

const SAFE_EXTENSIONS = new Set([
  ".md", ".txt", ".json", ".lock", ".yaml", ".yml", ".toml",
  ".png", ".jpg", ".gif", ".svg", ".ico", ".woff", ".woff2",
]);

/**
 * @param {{ extraPatterns?: Array<{ name: string, pattern: RegExp }> }} [options]
 */
export function createGitGuardian(options = {}) {
  const patterns = [...SECRET_PATTERNS, ...(options.extraPatterns ?? [])];

  /**
   * Scan staged files for secrets.
   * @param {string} repoPath
   * @returns {{ clean: boolean, violations: Array<{ file: string, line: number, pattern: string, snippet: string }> }}
   */
  function scanStagedFiles(repoPath) {
    let stagedOutput;
    try {
      stagedOutput = execSync("git diff --cached --name-only --diff-filter=ACM", {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 10_000,
      }).trim();
    } catch {
      return { clean: true, violations: [], error: "git command failed — not a git repo?" };
    }

    if (!stagedOutput) return { clean: true, violations: [] };

    const files = stagedOutput.split("\n").filter(Boolean);
    const violations = [];

    for (const file of files) {
      const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
      if (SAFE_EXTENSIONS.has(ext)) continue;

      let content;
      try {
        content = readFileSync(join(repoPath, file), "utf-8");
      } catch {
        continue;
      }

      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const { name, pattern } of patterns) {
          if (pattern.test(line)) {
            violations.push({
              file,
              line: i + 1,
              pattern: name,
              snippet: line.slice(0, 120).trim(),
            });
          }
        }
      }
    }

    return { clean: violations.length === 0, violations };
  }

  /**
   * Check if the repo's default remote is private.
   * @param {string} repoPath
   * @returns {{ isPrivate: boolean | null, remote: string | null, warning: string | null }}
   */
  function enforcePrivateRepo(repoPath) {
    let remote;
    try {
      remote = execSync("git remote get-url origin", {
        cwd: repoPath, encoding: "utf-8", timeout: 5_000,
      }).trim();
    } catch {
      return { isPrivate: null, remote: null, warning: "No origin remote found" };
    }

    const ghMatch = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (!ghMatch) {
      return { isPrivate: null, remote, warning: "Cannot determine visibility for non-GitHub remotes" };
    }

    const [, owner, repo] = ghMatch;
    try {
      const out = execSync(`gh api repos/${owner}/${repo} --jq .private`, {
        encoding: "utf-8", timeout: 10_000,
      }).trim();
      const isPrivate = out === "true";
      return {
        isPrivate,
        remote,
        warning: isPrivate ? null : `DANGER: ${owner}/${repo} is PUBLIC — agents must not push to public repos`,
      };
    } catch {
      return { isPrivate: null, remote, warning: "gh CLI not available — cannot verify repo visibility" };
    }
  }

  /**
   * Install a pre-push hook that blocks pushes to public repos.
   * Only manual `git push --no-verify` can bypass.
   * @param {string} repoPath
   */
  function installPrePushHook(repoPath) {
    const hooksDir = join(repoPath, ".git", "hooks");
    const hookPath = join(hooksDir, "pre-push");
    const hookScript = `#!/bin/sh
# Installed by MyClaw GitGuardian — blocks Agent pushes to public repos
REMOTE="$1"

# Check if public GitHub repo
if echo "$REMOTE" | grep -q "github.com"; then
  OWNER_REPO=$(echo "$REMOTE" | sed -E 's#.*github\\.com[:/]([^/]+/[^/.]+).*#\\1#')
  IS_PRIVATE=$(gh api "repos/$OWNER_REPO" --jq .private 2>/dev/null || echo "unknown")
  if [ "$IS_PRIVATE" = "false" ]; then
    echo "\\n[GitGuardian] BLOCKED: $OWNER_REPO is a PUBLIC repo."
    echo "[GitGuardian] Agents are not allowed to push to public repos."
    echo "[GitGuardian] Use 'git push --no-verify' for manual override.\\n"
    exit 1
  fi
fi

# Also scan for secrets in commits being pushed
RANGE="$3"
if [ -n "$RANGE" ]; then
  FILES=$(git diff --name-only "$RANGE" 2>/dev/null)
  for FILE in $FILES; do
    if git show "HEAD:$FILE" 2>/dev/null | grep -qE '(AKIA[0-9A-Z]{16}|-----BEGIN.*PRIVATE KEY-----|sk-[a-z0-9]{32,})'; then
      echo "\\n[GitGuardian] BLOCKED: potential secret detected in $FILE"
      exit 1
    fi
  done
fi
`;
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(hookPath, hookScript, "utf-8");
    chmodSync(hookPath, 0o755);
    return { installed: true, hookPath };
  }

  /**
   * Full pre-push guard: check visibility + scan secrets + block if needed.
   * Returns { blocked, reason } — for programmatic pre-push enforcement.
   */
  function prePushGuard(repoPath) {
    const visibility = enforcePrivateRepo(repoPath);
    if (visibility.isPrivate === false) {
      return {
        blocked: true,
        reason: `PUBLIC repo detected: ${visibility.remote}. Agents cannot push to public repos.`,
      };
    }
    const scan = scanStagedFiles(repoPath);
    if (!scan.clean) {
      return {
        blocked: true,
        reason: `Secrets detected: ${scan.violations.map(v => v.pattern).join(", ")}`,
      };
    }
    return { blocked: false, reason: null };
  }

  function listPatterns() {
    return patterns.map((p) => ({ name: p.name, source: p.pattern.source }));
  }

  return {
    scanStagedFiles,
    enforcePrivateRepo,
    installPrePushHook,
    prePushGuard,
    listPatterns,
  };
}
