export {
  cloudAuth,
  CloudAuthenticationError,
  CloudConfigurationError,
  createAuthService,
  hCaptchaSiteKey,
  isCloudConfigured,
  isLocalModeAllowed,
  requireCloudClient,
  supabase,
} from "./client.js";

export {
  CloudPersistenceError,
  createWorkspaceRepository,
  RECOVERY_SNAPSHOTS_TABLE,
  REPLACE_WORKSPACE_RPC,
  RESTORE_WORKSPACE_RPC,
  SAVE_WORKSPACE_RPC,
  WORKSPACES_TABLE,
  WorkspaceConflictError,
  workspaceRepository,
} from "./workspaceRepository.js";
