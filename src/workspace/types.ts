import type { WorkSpacePaths } from './paths.js';

export interface WorkSpaceRecord extends WorkSpacePaths {
  registeredAt: string;
  lastActiveAt?: string;
}

export interface WorkSpaceRegistrySnapshot {
  version: 1;
  workspaces: WorkSpaceRecord[];
}
