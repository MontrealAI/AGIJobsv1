# Protocol Invariants

The following properties are expected to hold at all times. Tests and property checks should encode these invariants explicitly.

1. **Stake Conservation** — For any worker, `totalDeposits >= lockedAmounts`. Locked stake cannot exceed total deposits.
2. **Fee Bounds** — `thresholds.feeBps` and `thresholds.slashBpsMax` never exceed 10,000 BPS.
3. **Dispute Resolution** — When resolving a dispute, `slashAmount` must be less than or equal to the configured `slashBpsMax` fraction of the job stake.
4. **Ownership** — After migrations, all Ownable contracts (modules, registry, pool) are owned by the multisig Safe.
5. **Timings** — Commit, reveal, and dispute windows are non-zero positive values.

Violating these invariants constitutes a critical issue.
