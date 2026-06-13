// Runtime environment flags derived from Vite build-time env vars.
// `VITE_ENVIRONMENT` is set to 'staging' on the staging frontend build only.
export const environment = (import.meta.env.VITE_ENVIRONMENT as string | undefined) ?? 'production';

// Staging-only features (TEST banner, beta "Report a bug" widget) gate on this.
export const isStaging = environment === 'staging';

export const appCommit = (import.meta.env.VITE_APP_COMMIT as string | undefined) ?? 'unknown';
