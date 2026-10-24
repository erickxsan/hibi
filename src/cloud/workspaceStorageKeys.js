// Browser storage keys tied to a signed-in account. They live apart from accountDeletion.js so the startup
// code can read them without downloading the account-deletion module; that module purges the per-account ones.
export const MIGRATION_MARKER_PREFIX = "minimal-class-manager:cloud-migration-dismissed:v1:";
export const LEGACY_DATA_CLAIM_KEY = "minimal-class-manager:legacy-data-claimed:v1";
export const UI_STORAGE_PREFIX = "minimal-class-manager:ui:v1:";
/** «Not now» on the Inicio recovery-key reminder, per account on this device. */
export const RECOVERY_REMINDER_DISMISSED_PREFIX = "hibi:recovery-key-reminder-dismissed:v1:";
