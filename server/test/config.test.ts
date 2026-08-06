/**
 * loadConfig — the flags whose default is load-bearing.
 *
 * PROMPT_LOG_VERBOSE is the one that must not be trusted to a README: verbose
 * prompt logging is a LOCAL debugging aid, so the config loader itself refuses
 * it in production rather than documenting that nobody should set it.
 */
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/platform/config.js';

describe('loadConfig — promptLogVerbose', () => {
  it('is false when the env var is absent', () => {
    expect(loadConfig({}).promptLogVerbose).toBe(false);
  });

  it('is true only for the literal string "true"', () => {
    expect(loadConfig({ PROMPT_LOG_VERBOSE: 'true' }).promptLogVerbose).toBe(true);
    expect(loadConfig({ PROMPT_LOG_VERBOSE: '1' }).promptLogVerbose).toBe(false);
    expect(loadConfig({ PROMPT_LOG_VERBOSE: 'yes' }).promptLogVerbose).toBe(false);
    expect(loadConfig({ PROMPT_LOG_VERBOSE: '' }).promptLogVerbose).toBe(false);
  });

  it('is FORCED false in production however the env var is set', () => {
    expect(
      loadConfig({ PROMPT_LOG_VERBOSE: 'true', NODE_ENV: 'production' }).promptLogVerbose,
    ).toBe(false);
  });

  it('is honoured outside production', () => {
    for (const NODE_ENV of ['development', 'test'] as const) {
      expect(loadConfig({ PROMPT_LOG_VERBOSE: 'true', NODE_ENV }).promptLogVerbose).toBe(true);
    }
  });
});
