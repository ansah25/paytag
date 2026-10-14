## Summary

<!-- What changed and why. -->

## Merge ceremony

Required before merging to `main`. Reviewers are independent agents that did not write the code: one does an adversarial, read-only review of `git diff main...HEAD`, and a second checks only the fixes for correctness and regressions.

- [ ] Green locally: suites touched by this change pass
- [ ] Adversarial review by an independent agent on `git diff main...HEAD`
- [ ] Every finding fixed or dismissed with a reason (below)
- [ ] Fix verification by a second independent agent
- [ ] CI green

### Review findings

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | | | Fixed in `<sha>` / Dismissed: reason |

### Fix verification

<!-- Verifier's verdict per finding, plus any regressions it found and how they were resolved. -->

## Test plan

<!-- Commands run, manual checks. -->
