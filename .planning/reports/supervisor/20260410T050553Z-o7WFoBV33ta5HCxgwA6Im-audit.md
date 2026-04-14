# Supervisor audit - 20260410T050553Z

## Reviewed

- Task: `o7WFoBV33ta5HCxgwA6Im`
- Title: Quality follow-up: [CRITICAL] review of task b5YVRlSPRB1sslteiYZPA (Quality follow-up: [WARN] review of task _vtj7Xq6...
- Module: `n/a`
- Stage: `verify`
- Files: `apps/security/src/git-guardian.mjs`, `apps/security/test/security.test.mjs`

## Findings

- [CRITICAL] `apps/security/src/git-guardian.mjs` - pre-push hook checks GitHub URL via $1, but Git passes remote name as arg1 and remote URL as arg2; public-repo blocking can be bypassed
- [CRITICAL] `apps/security/src/git-guardian.mjs` - pre-push hook reads $3 as RANGE, but pre-push only provides two args and refs arrive on stdin; secret scan path is incorrect
- [WARN] `apps/security/src/git-guardian.mjs` - security tests do not directly exercise installPrePushHook/prePushGuard regression paths
