# Parameter management reference

This guide documents the `npm run config:params` workflow that governs the
lifecycle timings and governance thresholds for the AGI Jobs protocol. It is
written for non-technical operators as well as engineers who need precise
validation semantics. Token, ENS, and registrar JSON profiles share the same
guardrails via `npm run config:profiles`, which mirrors the options below while
handling ENS namehashes and registrar domain hierarchies automatically.

## Overview

`npm run config:params` launches `scripts/edit-params.js`, a guardrail-heavy
editor for `config/params.json`. The script:

- loads the current parameter set and displays human-friendly summaries such as
  `604800 (1w)` or `250 bps (2.5%)`;
- accepts interactive input (default when running in a TTY) or deterministic
  overrides via `--set key=value` flags;
- validates ranges, logical relationships (for example `revealWindow < commitWindow`),
  and integer requirements before any data is written; and
- optionally writes a timestamped backup alongside the target file when `--backup`
  is provided.

## Input formats

| Parameter               | Kind               | Accepted examples             |
| ----------------------- | ------------------ | ----------------------------- |
| `commitWindow`          | Duration (seconds) | `86400`, `1d`, `2h30m`, `90m` |
| `revealWindow`          | Duration (seconds) | Same as `commitWindow`        |
| `disputeWindow`         | Duration (seconds) | Same as `commitWindow`        |
| `approvalThresholdBps`  | Basis points       | `6000`, `60%`, `62.5%`        |
| `quorumMin`/`quorumMax` | Integer counts     | `3`, `11`, `1_000`            |
| `feeBps`                | Basis points       | `250`, `2.5%`, `0.25%`        |
| `slashBpsMax`           | Basis points       | Same as `feeBps`              |

Notes:

- Duration shorthands can be chained (for example `1h30m15s`) and may include
  fractional components such as `0.5h`. The parser rounds to the nearest second.
- Basis point fields accept integer values or percentages. Percentages are
  converted to basis points and rounded to the nearest integer (for example
  `2.55%` → `255 bps`).
- Numeric literals may include underscores or spaces for readability (`1_200`,
  `1 200`).

## Validation rules

In addition to the minimum/maximum constraints embedded in `config/params.json`,
the editor enforces:

- every parameter must be present and represented as an integer;
- `quorumMin ≤ quorumMax`;
- `revealWindow < commitWindow` so the reveal phase cannot exceed the commit
  phase; and
- if `approvalThresholdBps > 0`, `quorumMin` must be at least `1`.

Validation errors are printed with a clear `✖` prefix and no data is written
until all issues are resolved.

## Non-interactive usage

```
npm run config:params -- \
  --no-interactive \
  --set commitWindow=48h \
  --set revealWindow=12h \
  --set feeBps=3% \
  --backup ./backups/params.json \
  --yes
```

- `--set` flags accept the same shorthand as the interactive prompts.
- `--no-interactive` disables prompts, allowing automation via CI/CD pipelines or
  infrastructure-as-code tooling.
- `--yes` skips the confirmation prompt once the validation summary looks
  correct.
- `--backup` without an argument stores a timestamped `.bak` file alongside the
  target JSON. Provide an explicit path to control the destination.

## Output summary

After validation the tool prints a before/after summary, highlighting changes
with a `•` bullet:

```
• commitWindow: 604800 (1w) → 28800 (8h)
  revealWindow: 86400 (1d) → 7200 (2h)
• feeBps: 250 bps (2.5%) → 300 bps (3%)
```

This makes it easy for reviewers to confirm the intent before approving a pull
request or signing a multisig transaction. Use the `--dry-run` flag to output the
resulting JSON without persisting changes when running audits or experiments.

## Troubleshooting

- "Invalid duration" errors mean the parser could not interpret the supplied
  value. Double-check that each segment includes a suffix (`h`, `m`, `s`, `d`,
  or `w`).
- "Value must be an integer" indicates that rounding was not possible. Ensure
  the supplied value resolves to a whole number of seconds or basis points.
- Use `npm run config:validate` after editing to assert the broader configuration
  (ENS, registrar, governance addresses) still satisfies on-chain invariants.

## Related automation

- CI executes `npm run config:params -- --no-interactive --dry-run` to ensure the
  default configuration remains parseable and to flag regressions early.
- `npm run configure:registry` and `npm run config:wizard` reuse the same parsing
  helpers when staging on-chain updates, so any improvements made here carry
  through to owner workflows automatically.
- Hardhat operators can call `npx hardhat job-registry:set-config --network <network> --timings '{"commitWindow":3600}'`
  or `npx hardhat job-registry:update-config --thresholds '{"feeBps":275}'` to apply the validated parameters on-chain
  with plan exports and owner enforcement without leaving the Hardhat environment. Append `--atomic` to the set-config command
  when broadcasting to rely on a single `setFullConfiguration` call instead of three sequential transactions.
