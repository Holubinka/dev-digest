# Skill Benchmark: pr-self-review

**Model**: claude-opus-5
**Date**: 2026-08-21T20:08:55Z
**Evals**: 0, 1, 2 (1 runs each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 89% ± 19% | +0.11 |
| Time | 686.5s ± 53.9s | 160.3s ± 50.4s | +526.1s |
| Tokens | 127480 ± 15775 | 70428 ± 12705 | +57052 |

## Notes

- 1 run per configuration, not 3 — real /pr-self-review --full runs cost ~10-12 min and ~100-150k tokens each, so variance across repeats was not measured this round.
- With-skill pass rate is 100% across all 9 assertions (3 fixtures x 3 planted issues); without-skill missed exactly one — the URL-shareable-state convention in eval-2, which has no generic-code-review analog.
- Tokens shown are the top-level orchestrating agent only. With-skill runs dispatch further subagents (2 Track B reviewers + one adversarial verifier per critical), so real total spend is higher than this table shows.
- eval-0 with_skill: 2 of 6 adversarial-verifier subagents never returned a notification; the orchestrator self-verified and disclosed this in the report rather than leaving them unresolved.
- eval-2 with_skill: the security agent initially graded a path-traversal finding critical; the adversarial verifier correctly refuted it to major using reachability evidence (dead code, no /api proxy, no /admin route) — the first real measurement of that verifier actually refuting rather than confirming.