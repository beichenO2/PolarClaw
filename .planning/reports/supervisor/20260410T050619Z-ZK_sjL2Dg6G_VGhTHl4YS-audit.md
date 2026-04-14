# Supervisor audit - 20260410T050619Z

## Reviewed

- Task: `ZK_sjL2Dg6G_VGhTHl4YS`
- Title: Quality follow-up: [WARN] review of task TBS8hT5JnJfgvnyzb0p3Z (Quality follow-up: [WARN] review of task KexkG3CTIIrr...
- Module: `n/a`
- Stage: `verify`
- Files: `apps/security/src/git-guardian.mjs`, `apps/security/test/security.test.mjs`

## Findings

- [CRITICAL] `apps/security/src/git-guardian.mjs` - pre-push hook checks GitHub URL via $1, but Git passes remote name as arg1 and remote URL as arg2; public-repo blocking can be bypassed
- [CRITICAL] `apps/security/src/git-guardian.mjs` - pre-push hook reads $3 as RANGE, but pre-push only provides two args and refs arrive on stdin; secret scan path is incorrect
- [WARN] `apps/security/src/git-guardian.mjs` - security tests do not directly exercise installPrePushHook/prePushGuard regression paths
