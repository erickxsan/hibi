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
  LOAD_WORKSPACE_RPC,
  RECOVERY_SNAPSHOTS_TABLE,
  RESET_WORKSPACE_RPC,
  REPLACE_WORKSPACE_RPC,
  RESTORE_WORKSPACE_RPC,
  SAVE_WORKSPACE_RPC,
  WORKSPACE_CHANGE_EVENTS_TABLE,
  WorkspaceConflictError,
  workspaceRepository,
} from "./workspaceRepository.js";

export {
  ACCOUNT_DELETION_CONFIRMATION,
  AccountDeletionError,
  createAccountDeletionService,
  LEGACY_DATA_CLAIM_KEY,
  MIGRATION_MARKER_PREFIX,
  purgeLocalAccountData,
  accountDeletionService,
} from "./accountDeletion.js";
