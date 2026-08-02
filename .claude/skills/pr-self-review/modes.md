# The two modes that needed a decision

`--freeze` and `--only critical` are the two of the four modes in
[SKILL.md](SKILL.md) §2 whose procedure is not simply "run steps 1–7". Both are written out
here rather than left implied. A `--full` or `--gates` run never needs this file.

`$TMP` below is `.pr-self-review/run`, and the snippets write it only for readability —
substitute the literal path, per [SKILL.md](SKILL.md) §3.0.

**`--freeze`.** Run steps 1–4 exactly as `--full`, then replace step 5 with:

```sh
for f in scope.json gates.json findings.json; do
  jq -e 'type == "array" or type == "object"' "$TMP/$f" >/dev/null 2>&1 && continue
  echo "STOP: $TMP/$f is missing, empty or not JSON. Freezing what a truncated file" >&2
  echo "      merged to would record a SHORTER baseline than the run actually saw," >&2
  echo "      and the baseline only ever shrinks. Fix the step that wrote it." >&2
  exit 1
done

jq -n --slurpfile s "$TMP/scope.json" --slurpfile g "$TMP/gates.json" \
      --slurpfile a "$TMP/findings.json" \
  '{ scope: $s[0], findings: ($s[0].flagged + $g[0].findings + $a[0]) }' \
  | bash scripts/pr-self-review/baseline.sh --freeze
```

Then **stop**. There is no step 6: a freeze writes no `latest.json`, so it grants no verdict and
unblocks nothing. Say what was frozen and that `/pr-self-review` must be run again for a verdict.

Three things to say out loud when you do it.

**A freeze records model findings only** — `source` beginning `agent `. `baseline.sh` drops
everything else on the way in, and its stderr line says how many of how many it kept, so a freeze
that looks smaller than the run is working correctly. It refuses them because a deterministic
finding is critical by definition and nothing may downgrade it: freezing this repo's two standing
`gate registry` criticals is exactly how a report came to print `FAIL repo registry` under the
header `PASS`. A red gate gets fixed, a committed secret gets removed; neither gets frozen. The
filter side refuses the same class, so an older `baseline.json` holding such a fingerprint cannot
silence it either.

The fingerprint is `{file, line, message}`, and a Track A finding stores twenty lines of raw
command output in `message` — so even before that rule, freezing a gate failure almost never
re-matched on the next run.

And the file only ever shrinks: re-freezing to clear a new finding is the one thing this baseline
cannot survive.

**`--only critical`.** Read the previous verdict **before** anything overwrites it:

```sh
jq -r '[.findings[] | select(.severity == "critical")
                    | select(((.source // "") | tostring) | startswith("agent ")) | .file] | unique[]' \
  .pr-self-review/latest.json > "$TMP/recheck" \
  || { echo 'could not read .pr-self-review/latest.json — it is missing or not JSON.' >&2
       echo 'There is no previous verdict to narrow. Run /pr-self-review --full.' >&2; exit 1; }
```

Only **Track B** criticals go on that list. A gate critical needs no narrowing — step 2 re-runs
every gate in full anyway, and `skills-lock.json` is not a file a subagent reviews.

**Check the exit status here, and do not later treat an empty `recheck` as an error.** Those are
two different states that both leave the file at 0 bytes, and only one of them is wrong. A branch
blocked **solely by Track A** — this repo's own state most days, where both criticals are
`gate registry` — has no Track B critical to narrow, so the extraction legitimately writes
nothing. That run must continue: an empty list means every previous finding is carried and none
dropped, which is the correct answer, and [SKILL.md](SKILL.md) §3.0 already names
"`--only critical` with nothing to
re-check" as one of the three paths the step-0 seed exists to keep alive. A `latest.json` that is
missing or corrupt leaves the same 0 bytes and is a real stop — which is what the `||` above is
for.

**Both `--only critical` snippets guard `.source` the same way `baseline.sh` does**, and for the
same reason: this command reads `latest.json`, whose findings were written by a model, and
`baseline.sh` deliberately lets a malformed-source finding *through* rather than dropping the
payload — so `report.sh` records it and the next run reads it back. A bare
`.source | startswith(…)` on that entry raises `startswith() requires string inputs` and exits 5.

No `latest.json` means there is no last run to narrow — say so and run `--full` instead. Then:

- Steps 1 and 2 run **in full**. Track A is seconds, and it is the half that blocks a push.
- Steps 3 and 4 cover only the routed files listed in `$TMP/recheck` — both Track B agents, as
  ever, since neither is partitioned. Narrowing a re-check narrows the files, never the roster.
- Step 5 **carries forward** the previous run's subagent findings for every file that was *not*
  re-checked, merged with the new ones. Dropping them is how repeatedly narrowing a re-check
  turns a blocked branch green without a line being fixed. Gate and `gate scope` findings are not
  carried — they re-ran:

  ```sh
  for f in .pr-self-review/latest.json "$TMP/findings.json"; do
    [ -s "$f" ] && continue
    echo "carry-forward: $f is missing or empty. STOP." >&2
    echo "  No latest.json and there is nothing to carry forward at all; an EMPTY" >&2
    echo "  findings.json makes \$n[0] null, jq exits 0, and the re-check's own" >&2
    echo "  findings are the ones that vanish. Re-run /pr-self-review --full." >&2
    exit 1
  done
  [ -f "$TMP/recheck" ] || { echo 'carry-forward: no recheck file — the extraction' >&2
                             echo '  above never ran. Run it first.' >&2; exit 1; }
  n_agents="$(jq 'length' "$TMP/agents.json" 2>/dev/null)" || n_agents=0
  if [ -s "$TMP/recheck" ] && [ "${n_agents:-0}" -eq 0 ]; then
    echo 'carry-forward: recheck lists files, but agents.json is empty — no subagent' >&2
    echo '  ran over them. Continuing would drop every previous finding on those' >&2
    echo '  files and replace them with nothing, so a blocked branch goes green' >&2
    echo '  without a line being fixed. Dispatch step 3, or run --full.' >&2
    exit 1
  fi
  jq -n --slurpfile p .pr-self-review/latest.json --slurpfile n "$TMP/findings.json" \
        --rawfile r "$TMP/recheck" \
    '($r | split("\n") | map(select(length > 0))) as $re
     | [ $p[0].findings[]
         | . as $f
         | select(((($f.source // "") | tostring) | startswith("agent ")))
         | select(($re | index(($f.file // "") | tostring)) | not) ] + $n[0]' \
    > "$TMP/merged.json" \
    && mv "$TMP/merged.json" "$TMP/findings.json" \
    || { echo 'carry-forward FAILED — findings from files that were not re-checked' >&2
         echo 'have been lost. Do NOT continue to step 5. Re-run /pr-self-review --full.' >&2
         rm -f "$TMP/merged.json"; exit 1; }
  ```

  **The command must end the run when it fails, not merely decline to overwrite.** Six things
  had to be true at once here, and each was wrong at some point:

  1. **Never redirect into `findings.json` while `--slurpfile n` is reading it.** The shell
     truncates a redirection target before `jq` starts, so `$n` comes back `[]`, `$n[0]` is
     `null`, and `[carried] + null` is silently just `[carried]`. Everything the re-check found
     disappears.
  2. **`mv` only on success — and stop when there is no success.** A failing `jq` still leaves
     the 0-byte `merged.json` its redirect created; an unconditional `mv` installs *that* as
     `findings.json`, step 5 slurps it to `null`, `+` takes null as its identity, and the verdict
     reads `pass`. But `&&` alone only saves the *new* findings: `findings.json` keeps the
     re-check's own array and every **carried** finding is silently gone, so a critical on a file
     this run never looked at vanishes and steps 5–6 print `PASS`. That is why the failure branch
     exits non-zero rather than leaving prose behind. Prose is not a guard when the failure is
     silent.
  3. **Bind the finding to `$f` before the `index`.** After the pipe into `index()`, a bare
     `.file` reads off `$re`, not off the finding — `jq` answers
     `Cannot index array with string "file"`.
  4. **Guard the inputs before the `jq`, not only its exit status.** For the failure that
     matters most the `||` branch is unreachable: with a 0-byte `findings.json`, `$n[0]` is
     `null`, `[carried] + null` is `[carried]`, and jq **exits 0**. `mv` runs, the carried
     findings survive, and the **re-check's own** findings — the only reason the run happened —
     are the ones that disappear. That is the exact mirror of 1, and no exit-status check can
     see it. The `for` loop above is what catches it.
  5. **`-s` on the two JSON inputs, `-f` on `recheck`, and never the other way round.** An empty
     `latest.json` or `findings.json` is always a lost file. An empty `recheck` is the ordinary
     state of a branch whose only criticals came from Track A, and `-s` there hard-stops a run
     that would have produced exactly the right answer — an empty `$re` matches nothing in
     `index()`, so everything is carried and nothing dropped. A guard that refuses a correct run
     teaches people to delete the guard.
  6. **A non-empty `recheck` with an empty `agents.json` is the same failure inverted, and it is
     the one route no script can catch.** The `select(… | not)` correctly *declines* to carry a
     re-checked file's old findings — that is the mechanism working. But if step 3 never
     dispatched, nothing replaces them: the critical that listed the file is dropped, `[] + []`
     is `[]`, and the run prints `PASS` on a branch where nothing was fixed. `report.sh` cannot
     see it, because `--only critical` records `mode: "gates"` by design and that is
     indistinguishable there from a legitimate `--gates` run. If files were listed for re-check,
     subagents were supposed to run over them; assert it here or nowhere.

  The first four are one failure mode wearing four hats: something upstream goes wrong, `null`
  or a short array flows on unremarked, and an empty or truncated findings list becomes a `pass`
  on a branch that has none. `report.sh` rule 6 catches the shapes that reach it as null, non-array,
  or an array with an unreadable element, but a *truncated yet well-formed* array is
  indistinguishable from a clean run by then. The net does not cover this one. Get it right at
  the site.

- Step 6 records **`mode: "gates"`, not `"full"`.** Track A ran whole, Track B did not, and
  `gates` is exactly the mode `gate.sh` already treats as *enough for a push, not enough for a
  PR*. A partial review must never open a PR, and `latest.json` has only these two mode values —
  inventing a third would still be accepted for a push while confusing every later reader.
