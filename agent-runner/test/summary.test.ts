/**
 * `reasonText` — the one place a line is cut twice.
 *
 * The artifact this produces is written as JSON, downloaded by the server and
 * written into a Postgres `text` column, which refuses an unpaired surrogate.
 * So the assertion is a UTF-8 round trip rather than a length: a lone surrogate
 * survives `.length` and comes back as U+FFFD.
 */
import { describe, it, expect } from 'vitest';
import { reasonText, summaryLine } from '../src/summary.js';

/** What `Buffer.from(s).toString()` does to text that is not valid UTF-8. */
const survivesUtf8 = (s: string) => Buffer.from(s, 'utf8').toString('utf8') === s;

describe('reasonText', () => {
  it('leaves a short line alone', () => {
    expect(reasonText('the diff was too large to review')).toBe(
      'the diff was too large to review',
    );
  });

  it('cuts an over-long line without splitting a surrogate pair', () => {
    // 201 ASCII then 400 astral: `summaryLine` caps at 500 CODE POINTS and adds
    // an ellipsis, so the string is 501 code points and 800 UTF-16 units. A
    // `.slice(0, 500)` here lands inside a pair — that was the defect.
    const text = 'a'.repeat(201) + '\u{1F525}'.repeat(400);
    const out = reasonText(text);

    expect(summaryLine(text).length).toBeGreaterThan(500); // the premise
    expect([...out].length).toBeLessThanOrEqual(500);
    expect(survivesUtf8(out)).toBe(true);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out)).toBe(false);
  });

  it('cuts a line of astral characters alone the same way', () => {
    const out = reasonText('\u{1F525}'.repeat(600));
    expect(survivesUtf8(out)).toBe(true);
    expect([...out].length).toBeLessThanOrEqual(500);
  });
});
