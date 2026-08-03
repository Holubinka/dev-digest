---
description: Review every open change against this repo's skills and gates, and write the verdict
---

Run the `pr-self-review` skill over all open changes on this branch.

Arguments: $ARGUMENTS

- no argument, or `--full` — Track A and Track B, writes `mode: "full"`.
  Required before `gh pr create`.
- `--gates` — Track A only, no subagents, seconds. Enough for `git push`.
- `--only critical` — re-check the files that carried a critical last run.
- `--freeze` — record today's findings as the baseline. Use once, deliberately.

Report the verdict, then stop. Do not fix anything unless asked.
