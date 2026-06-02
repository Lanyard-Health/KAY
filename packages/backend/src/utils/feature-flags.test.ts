import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isNewSubmissionPipelineEnabled } from './feature-flags.js';

describe('feature-flags', () => {
  const original = process.env['USE_NEW_SUBMISSION_PIPELINE'];

  beforeEach(() => {
    delete process.env['USE_NEW_SUBMISSION_PIPELINE'];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env['USE_NEW_SUBMISSION_PIPELINE'];
    } else {
      process.env['USE_NEW_SUBMISSION_PIPELINE'] = original;
    }
  });

  describe('isNewSubmissionPipelineEnabled', () => {
    it('returns false when env var is unset', () => {
      expect(isNewSubmissionPipelineEnabled()).toBe(false);
    });

    it('returns false when env var is "false"', () => {
      process.env['USE_NEW_SUBMISSION_PIPELINE'] = 'false';
      expect(isNewSubmissionPipelineEnabled()).toBe(false);
    });

    it('returns false for "1"/"yes"/"TRUE" (only exact "true" counts)', () => {
      process.env['USE_NEW_SUBMISSION_PIPELINE'] = '1';
      expect(isNewSubmissionPipelineEnabled()).toBe(false);
      process.env['USE_NEW_SUBMISSION_PIPELINE'] = 'yes';
      expect(isNewSubmissionPipelineEnabled()).toBe(false);
      process.env['USE_NEW_SUBMISSION_PIPELINE'] = 'TRUE';
      expect(isNewSubmissionPipelineEnabled()).toBe(false);
    });

    it('returns true only for exact string "true"', () => {
      process.env['USE_NEW_SUBMISSION_PIPELINE'] = 'true';
      expect(isNewSubmissionPipelineEnabled()).toBe(true);
    });
  });
});
