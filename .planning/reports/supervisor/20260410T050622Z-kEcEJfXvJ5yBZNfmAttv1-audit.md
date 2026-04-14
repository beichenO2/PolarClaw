# Supervisor audit - 20260410T050622Z

## Reviewed

- Task: `kEcEJfXvJ5yBZNfmAttv1`
- Title: Quality follow-up: [CRITICAL] review of task Iht_8H04vV3ScluaJJyCP (Quality follow-up: [CRITICAL] review of task 1JDl...
- Module: `n/a`
- Stage: `verify`
- Files: `apps/security/src/git-guardian.mjs`, `apps/security/test/security.test.mjs`

## Findings

- [CRITICAL] `apps/security/src/git-guardian.mjs` - pre-push hook checks GitHub URL via $1, but Git passes remote name as arg1 and remote URL as arg2; public-repo blocking can be bypassed
- [CRITICAL] `apps/security/src/git-guardian.mjs` - pre-push hook reads $3 as RANGE, but pre-push only provides two args and refs arrive on stdin; secret scan path is incorrect
- [WARN] `apps/security/src/git-guardian.mjs` - security tests do not directly exercise installPrePushHook/prePushGuard regression paths
