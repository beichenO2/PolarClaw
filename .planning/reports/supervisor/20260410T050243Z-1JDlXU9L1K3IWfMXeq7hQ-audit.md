# Supervisor audit - 20260410T050243Z

## Reviewed

- Task: `1JDlXU9L1K3IWfMXeq7hQ`
- Title: Quality follow-up: 审查任务 ltr8pleZnBjRP_yMs2wCQ（FIX REQ-A03）发现 apps/security/src/git-guardian.mjs 的 pre-push hook 参数使用不...
- Module: `n/a`
- Stage: `verify`
- Files: `apps/security/src/git-guardian.mjs`, `apps/security/test/security.test.mjs`

## Findings

- [CRITICAL] `apps/security/src/git-guardian.mjs` - pre-push hook checks GitHub URL via $1, but Git passes remote name as arg1 and remote URL as arg2; public-repo blocking can be bypassed
- [CRITICAL] `apps/security/src/git-guardian.mjs` - pre-push hook reads $3 as RANGE, but pre-push only provides two args and refs arrive on stdin; secret scan path is incorrect
- [WARN] `apps/security/src/git-guardian.mjs` - security tests do not directly exercise installPrePushHook/prePushGuard regression paths
