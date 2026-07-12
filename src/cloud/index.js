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
  RESET_WORKSPACE_RPC,
  SAVE_WORKSPACE_RPC,
  WORKSPACES_TABLE,
  WorkspaceConflictError,
  workspaceRepository,
} from "./workspaceRepository.js";
