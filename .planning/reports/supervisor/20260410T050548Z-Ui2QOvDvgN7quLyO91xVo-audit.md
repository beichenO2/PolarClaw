# Supervisor audit - 20260410T050548Z

## Reviewed

- Task: `Ui2QOvDvgN7quLyO91xVo`
- Title: Quality follow-up: [CRITICAL] review of task Ljv2rCqt7JIm8cCgQcJeJ (Quality follow-up: [CRITICAL] review of task _vtj...
- Module: `n/a`
- Stage: `verify`
- Files: `apps/security/src/git-guardian.mjs`, `apps/security/test/security.test.mjs`

## Findings

- [CRITICAL] `apps/security/src/git-guardian.mjs` - pre-push hook checks GitHub URL via $1, but Git passes remote name as arg1 and remote URL as arg2; public-repo blocking can be bypassed
- [CRITICAL] `apps/security/src/git-guardian.mjs` - pre-push hook reads $3 as RANGE, but pre-push only provides two args and refs arrive on stdin; secret scan path is incorrect
- [WARN] `apps/security/src/git-guardian.mjs` - security tests do not directly exercise installPrePushHook/prePushGuard regression paths
