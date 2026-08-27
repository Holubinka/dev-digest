import { appendFileSync } from 'node:fs';
import { truncate } from './text.js';

const MAX_SUMMARY_LINE = 500;

/**
 * Flatten one line so it cannot become markup.
 *
 * Some of what reaches the summary is derived from foreign text — a YAML parse
 * error quotes the offending source line, a skill slug comes from a manifest in
 * someone else's branch — and `$GITHUB_STEP_SUMMARY` is rendered as markdown.
 * Every line is therefore one line of escaped plain text, which is why the
 * runner never writes markdown of its own here.
 */
export function summaryLine(text: string): string {
  const flat = text.replace(/[\r\n]+/g, ' ').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const points = [...flat];
  return points.length <= MAX_SUMMARY_LINE
    ? flat
    : `${points.slice(0, MAX_SUMMARY_LINE).join('')}…`;
}

/**
 * The same line, cut to what `CiResultArtifact.reason` accepts.
 *
 * `truncate`, never `slice`: `summaryLine` above cuts by CODE POINT and appends
 * an ellipsis, so its result can be 501 code points — more than 500 UTF-16
 * units as soon as the text holds anything astral. A `slice` then lands mid
 * surrogate pair, and the lone surrogate travels in the artifact JSON to a
 * Postgres `text` column, which refuses it. `text.ts` cites the same rule.
 */
export function reasonText(text: string): string {
  return truncate(summaryLine(text), MAX_SUMMARY_LINE);
}

/**
 * Append one line to the job summary (`$GITHUB_STEP_SUMMARY`) and echo it to
 * stdout, so a run says what it did whether or not the file exists.
 */
export function jobSummary(text: string, env: NodeJS.ProcessEnv = process.env): void {
  const line = summaryLine(text);
  console.log(line);
  const file = env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    appendFileSync(file, `${line}\n`, 'utf8');
  } catch (err) {
    console.log(`job summary not written: ${(err as Error).message}`);
  }
}
