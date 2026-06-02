/**
 * Feature-flag helpers. Each helper reads its env var fresh on every call so
 * tests can mutate process.env between calls without re-importing the module.
 *
 * Convention: exact string "true" only — no "1", "yes", "TRUE". Reduces
 * ambiguity in CI logs and matches the existing USE_LOCALSTACK pattern.
 */

export function isNewSubmissionPipelineEnabled(): boolean {
  return process.env['USE_NEW_SUBMISSION_PIPELINE'] === 'true';
}
