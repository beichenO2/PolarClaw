export { WorkSpaceRegistry } from './registry.js';
export { findCanonicalProjectRoot, __clearWorktreeCachesForTesting } from './canonical-root.js';
export {
  POLARCLAW_HOME,
  PROJECT_META_DIR,
  createProjectId,
  hashProjectPath,
  resolveWorkSpacePaths,
  type WorkSpacePaths,
} from './paths.js';
export type { WorkSpaceRecord, WorkSpaceRegistrySnapshot } from './types.js';
