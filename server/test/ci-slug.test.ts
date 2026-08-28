/**
 * P3.3 — the bundle's file-name slugs (AC-17, AC-18, AC-105).
 *
 * Pure functions, so no fixture and no container. The cases that matter are the
 * ones a `String.replace` over UTF-16 units gets wrong: an emoji is a surrogate
 * PAIR, and testing its halves separately turns one character into two hyphens.
 */
import { describe, it, expect } from 'vitest';
import { disambiguate, slugify } from '../src/modules/ci/generate/slug.js';

describe('slugify (AC-17, AC-105)', () => {
  it('lowercases and collapses every run of non-alphanumerics into one hyphen', () => {
    expect(slugify('Security Reviewer', 'id-1')).toBe('security-reviewer');
    expect(slugify('API   Guard!!!v2', 'id-1')).toBe('api-guard-v2');
  });

  it('trims hyphens at both ends', () => {
    expect(slugify('  --Rules--  ', 'id-1')).toBe('rules');
    expect(slugify('...leading and trailing...', 'id-1')).toBe('leading-and-trailing');
  });

  it('keeps letters of any script rather than erasing them', () => {
    expect(slugify('Рев’ю коду', 'id-1')).toBe('рев-ю-коду');
    expect(slugify('コードレビュー', 'id-1')).toBe('コードレビュー');
  });

  it('falls back to the id when nothing alphanumeric survives (AC-105)', () => {
    expect(slugify('!!!', 'agent-42')).toBe('agent-42');
    expect(slugify('', 'agent-42')).toBe('agent-42');
    expect(slugify('   ', 'agent-42')).toBe('agent-42');
  });

  it('treats an astral character as ONE character, not two surrogate halves', () => {
    // "🚀" is a surrogate pair. Iterating by UTF-16 unit classifies each half as
    // its own non-alphanumeric and yields `a--b`, which the collapse then hides
    // as `a-b` — the same shape as the correct answer, for the wrong reason.
    // `🚀🚀` is where the two readings separate: two code points, one hyphen.
    expect(slugify('a🚀🚀b', 'id-1')).toBe('a-b');
    expect(slugify('🚀', 'agent-42')).toBe('agent-42');
  });
});

describe('disambiguate (AC-18)', () => {
  it('leaves distinct slugs alone', () => {
    expect(disambiguate(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('numbers repeats from -2 in binding order', () => {
    expect(disambiguate(['rules', 'rules', 'rules'])).toEqual(['rules', 'rules-2', 'rules-3']);
  });

  it('skips a suffix another name already occupies', () => {
    // "Rules" and "Rules 2" slug to `rules` and `rules-2`; a counter that did
    // not re-check would hand the second `rules` the taken `rules-2`.
    expect(disambiguate(['rules', 'rules-2', 'rules'])).toEqual(['rules', 'rules-2', 'rules-3']);
  });

  it('never returns two equal slugs', () => {
    const out = disambiguate(['x', 'x', 'x-2', 'x', 'x-3']);
    expect(new Set(out).size).toBe(out.length);
  });
});
