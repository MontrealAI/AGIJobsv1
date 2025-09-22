# AGIJobsv1 — Protocol-Only (Truffle)

[![Coverage](https://codecov.io/gh/agi-protocol/AGIJobsv1/branch/main/graph/badge.svg)](https://codecov.io/gh/agi-protocol/AGIJobsv1)

Institutional-grade, ENS-gated job coordination protocol. Contracts only: Solidity, Truffle migrations, tests, CI.

## Quickstart

```bash
npm ci
npm run build
npm run test
npm run coverage
npm run config:validate
npm run diagnose
```

`npm run coverage` enforces a 90% minimum threshold across lines, branches, and functions to match our CI gate. When the CI workflow has access to the repository `CODECOV_TOKEN` secret (for pushes and internal branches), it uploads `coverage/lcov.info` to Codecov so the badge above reflects the latest main-branch run automatically, even for private mirrors; forked pull requests skip the upload without failing the build.

`npm run diagnose` runs a comprehensive readiness audit: it checks Node.js/npm versions against the repository baseline, confirms Hardhat and Truffle are installed, reuses the configuration validator, and flags missing deployment environment variables so non-technical operators can prepare production releases safely.

### Agent gateway commit/reveal workflow

Operators interacting with the on-chain gateway must follow the commit/reveal lifecycle enforced by `JobRegistry`:

1. Export a WebSocket RPC endpoint (for example `JOB_REGISTRY_WS=ws://127.0.0.1:8545`) and a funded worker key (`WORKER_PRIVATE_KEY=0x…`).
2. Subscribe to new jobs with `node examples/v2-agent-gateway.js watch` to monitor `JobCreated(uint256,address,uint256)` events as they arrive.
3. When you decide to take a job, call `node examples/v2-agent-gateway.js commit <jobId>`. The script generates a random 32-byte secret, computes the commit hash, and persists the secret locally in `examples/.commit-secrets.json` so it can be revealed later.
4. After producing the work product, reveal the commit with `node examples/v2-agent-gateway.js reveal <jobId>`. Successful reveals automatically delete the stored secret.
5. Governance (or another authorized owner account) can finalize revealed jobs via `node examples/v2-agent-gateway.js finalize <jobId> <success>` which forwards the boolean success flag to `finalizeJob(jobId, success)`.

Keep the `.commit-secrets.json` file secured—it contains the raw secrets required to reveal in-flight commitments. If you prefer a different storage location, override it with `JOB_COMMIT_STORE=/path/to/store.json`.

## Advanced validation

- **Property-based fuzzing** — Install [Echidna](https://github.com/crytic/echidna) locally and run `npm run fuzz:echidna` to execute the `EchidnaJobRegistryInvariants` harness with the quick `tools/echidna.yaml` profile. The command reuses the same configuration the CI smoke test runs and writes its corpus to `echidna-corpus/` (ignored from source control). For deeper campaigns, call `npm run fuzz:echidna:long` to switch to the extended `tools/echidna-long.yaml` profile used by the scheduled nightly workflow.
- **Gas accounting** — `npm run gas` boots a transient Hardhat node, executes the full Truffle suite with `eth-gas-reporter`, and saves both the console-formatted table (`gas-report.txt`) and structured metrics (`gasReporterOutput.json`). Monitor these artifacts in PRs to flag regressions; CI uploads the same files for every run so reviewers can diff them against previous executions.

## Configure

```bash
cp .env.example .env
# set MNEMONIC, RPCs, ETHERSCAN_API_KEY, GOV_SAFE, TIMELOCK_ADDR
```

Edit configuration files under `config/` to match the deployment environment:

- `config/agialpha.dev.json` / `config/agialpha.sepolia.json` / `config/agialpha.mainnet.json` — ERC-20 token parameters (address,
  symbol, name, decimals) and burn address. The development variant ships with a `mock` stake token marker that triggers a mock deployment during
  migrations, while the dedicated Sepolia profile prevents local development runs from overwriting testnet addresses.
- `config/ens.dev.json` / `config/ens.sepolia.json` / `config/ens.mainnet.json` — ENS registry and subdomain roots (refresh
  `npm run namehash -- <variant>` or `node scripts/compute-namehash.js <path-to-config>`; the variant command defaults to
  `mainnet`).
- `config/params.json` — Commit/reveal/dispute windows and governance thresholds. Run
  `npm run config:params` for an interactive editor that validates ranges, highlights
  changes, and writes the updated JSON back to disk. Non-interactive environments can
  provide explicit overrides via `npm run config:params -- --no-interactive --set feeBps=300 --yes`.
- Run `npm run config:validate` after editing to confirm addresses, namehashes, and governance parameters satisfy production
  guardrails before broadcasting migrations.

### JobRegistry configuration helper

- Execute `npm run configure:registry` for a non-destructive dry run that compares the on-chain JobRegistry wiring, lifecycle

  timings, and governance thresholds against the repository defaults. The summary highlights any drift and prints the sender,
  owner, and params profile so operators can confirm the context before acting.

- Pass `-- --execute --from 0xYourOwnerAddress` to broadcast updates from an authorized account. The helper automatically
  repopulates missing module addresses from local deployments, applies overrides provided via CLI flags (for example,
  `--modules.identity` or `--thresholds.feeBps`), and validates all numerical constraints before submitting transactions.
- Override the default configuration profile with `-- --params /path/to/params.json` when staging alternate environments, or
  use `-- --variant sepolia` to label the summary with the intended target network.

### JobRegistry configuration console

- Call `npm run config:console -- --network <network> status` for a concise snapshot of module wiring, lifecycle timings, and threshold values along with the configuration completeness flags.
- Switch to `set` to align on-chain values with repository defaults or explicit overrides using the same flags accepted by `configure:registry`; dry runs print the planned diffs and `-- --execute` broadcasts `setModules`, `setTimings`, and `setThresholds` transactions sequentially.
- Use the `update` action with a single `--modules.<key>`, `--timings.<key>`, or `--thresholds.<key>` flag to invoke the granular update functions. The console validates invariants, emits a Safe-ready transaction payload during dry runs, and refuses zero-address or misordered quorum updates before touching the chain.

### JobRegistry owner console

- Launch the guided owner workflow with `npm run owner:console -- --network <network> status` to inspect configuration or
  `npm run owner:console -- --network <network> extend --job <id> --commit-extension 3600` to plan actions.
- The console prints a Safe-ready transaction payload during dry runs so operators can copy/paste it into a multisig. Add
  `--execute` once satisfied with the plan; the script verifies the sender is the on-chain owner before broadcasting.
- `extend`, `finalize`, `timeout`, and `resolve` commands enforce the same invariants as the contracts (quorum bounds,
  slashing ceilings, lifecycle states) so non-technical operators receive human-readable error messages before risking gas.

### Alpha Club activation

Premium `alpha.club.agi.eth` identities ship pre-configured in `config/ens.*.json`. The registrar enforces the 5,000 `$AGIALPHA` price floor automatically, so only funded registrations can mint these labels. `config/registrar.mainnet.json` now fixes both the minimum and maximum `alpha` label price at exactly 5,000 tokens, and `npm run registrar:verify` fails if the deployed `ForeverSubdomainRegistrar` drifts above that ceiling. Governance controls whether the `IdentityRegistry` marks the alpha namespace as officially active via the `alphaEnabled` flag that `configureEns` manages.

- **Before launch.** Keep `alphaEnabled === false` until the Alpha Club landing page and onboarding flow are live. During this staging window, avoid advertising the tier publicly—the registrar still blocks unfunded attempts and the on-chain registry now rejects alpha identities, so the namespace remains inert until governance flips the flag. Downstream systems calling `isClubAddress` will receive `false`, and `clubNodeOwner` reverts for alpha derivations while the tier is inactive.
- **Flip the switch.** When the program launches, execute `configureEns(alphaClubRootHash, /*alphaEnabled=*/true)` from the Safe. The call emits an event and updates `alphaEnabled()` so downstream relays, analytics, and subgraph indexers can record the activation moment. Capture the transaction hash and resulting state in `docs/mainnet-deployment-simulation.md` for posterity.
- **Verify on-chain state.** Post-activation, confirm the registry reports the expected status:

  ```javascript
  IdentityRegistry.deployed().then(async (registry) => console.log(await registry.alphaEnabled()));
  ```

  The ENS ownership rule means `alice.alpha.club.agi.eth` already counts as a valid club identity when the label is owned by `alice`, but toggling the flag gives integrators an explicit signal that premium identities are supported.

Sepolia deployments now read from their own configuration files, so populate `config/agialpha.sepolia.json` and
`config/ens.sepolia.json` with the staging token and ENS registry addresses before migrating to that network.

### Manual verification: ENS namehash script

1. Edit `config/ens.dev.json` to set distinct `agentRoot` / `clubRoot` placeholder values.
2. Run `node scripts/compute-namehash.js config/ens.dev.json` to update hashes in-place for the explicit file path.
3. Restore the original names and run `npm run namehash -- dev` (or omit the argument to target `mainnet`) to confirm the
   variant-based workflow still rewrites the resolved config file.

## Mainnet deployment profile

The repository is pre-configured for Ethereum mainnet and the production $AGIALPHA stake token. Confirm the following addresses
in `config/agialpha.mainnet.json` and `config/ens.mainnet.json` before migrating:

| Component                 | Value                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------- |
| Stake token (`$AGIALPHA`) | `0xA61a3B3a130a9c20768EEBF97E21515A6046a1fA`                                           |
| Token decimals            | `18`                                                                                   |
| Stake burn address        | `0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000`                                           |
| ENS registry              | `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`                                           |
| Agent ENS root            | `agent.agi.eth` (`0x2c9c6189b2e92da4d0407e9deb38ff6870729ad063af7e8576cb7b7898c88e2d`) |
| Club ENS root             | `club.agi.eth` (`0x39eb848f88bdfb0a6371096249dd451f56859dfe2cd3ddeab1e26d5bb68ede16`)  |

Operational parameters shipped in `config/params.json` align with the governance-approved mainnet timings:

| Parameter                 | Value            | Notes                                |
| ------------------------- | ---------------- | ------------------------------------ |
| `commitWindow`            | `604800` seconds | 7 days to collect worker commits.    |
| `revealWindow`            | `86400` seconds  | 1 day for reveal submissions.        |
| `disputeWindow`           | `259200` seconds | 3 days for dispute escalation.       |
| `approvalThresholdBps`    | `6000`           | 60% reveal approval threshold.       |
| `quorumMin` / `quorumMax` | `3` / `11`       | Bounds for validator committee size. |
| `feeBps`                  | `250`            | 2.5% protocol fee.                   |
| `slashBpsMax`             | `2000`           | Maximum 20% slash per dispute.       |

## Deploy (Sepolia)

```bash
npm run namehash
npm run migrate:sepolia
npm run verify:sepolia
npm run export:artifacts
```

`npm run export:artifacts` replays migrations against a local Hardhat node when `NETWORK` points at a development sandbox, but for live targets such as `mainnet` or `sepolia` it skips redeployments and only exports addresses/ABIs from the existing Truffle artifacts. Use `npm run export:abis` when you only need to refresh the ABI manifest after a compile.

## Verify (Mainnet)

```bash
npm run verify:mainnet
```

This command calls `truffle run verify` with the production deployment profile so the contracts above receive source-level verification on Etherscan. If the API submission fails (for example, because the flatten step times out), use the helper script in `scripts/flatten.sh` to regenerate the single-file artifacts before retrying the verification request.

- IdentityRegistry — [0x0FAa08A6f25B72b9394145e080cE407f570203a4](https://etherscan.io/address/0x0FAa08A6f25B72b9394145e080cE407f570203a4#code)
- StakeManager — [0x312cAA260EaDba4012F024D21F431eA1Da01EBFE](https://etherscan.io/address/0x312cAA260EaDba4012F024D21F431eA1Da01EBFE#code)
- FeePool — [0x2B2C4B855505F5Ac4839b1B2cc6BCEf76FF8F26A](https://etherscan.io/address/0x2B2C4B855505F5Ac4839b1B2cc6BCEf76FF8F26A#code)
- ValidationModule — [0xE72B348bCA4DAAD3d8886342557d581B50Bf3971](https://etherscan.io/address/0xE72B348bCA4DAAD3d8886342557d581B50Bf3971#code)
- DisputeModule — [0x21A21fa613917600e9dDE4441920562bB6238DaE](https://etherscan.io/address/0x21A21fa613917600e9dDE4441920562bB6238DaE#code)
- ReputationEngine — [0x3eEAEf0dddbda233651dc839591b992795Ba7168](https://etherscan.io/address/0x3eEAEf0dddbda233651dc839591b992795Ba7168#code)
- CertificateNFT — [0x346422cF9c620668089453838EDD1a30F9b1A273](https://etherscan.io/address/0x346422cF9c620668089453838EDD1a30F9b1A273#code)
- JobRegistry — [0x026A3CA6397910FD2BD338a79D4105c732A3426C](https://etherscan.io/address/0x026A3CA6397910FD2BD338a79D4105c732A3426C#code)

## Flatten contracts

Generate single-file Solidity sources for third-party verifiers with the helper script:

```bash
./scripts/flatten.sh
```

The script writes flattened sources to `artifacts-public/flat/`, mirroring the contract subdirectories (for example `core/StakeManager.flat.sol`) and skipping library/test harness directories so the output focuses on deployable entrypoints. It reuses the repository's local `truffle-flattener` installation. If the script is unavailable in your shell, fall back to the underlying command:

```bash
npx truffle-flattener <path-to-contract> > artifacts-public/flat/<Contract>.flat.sol
```

## Verify wiring

Run the wiring checker to confirm deployed contract addresses match the expected configuration:

```bash
npm run wire:verify
```

The checker now enforces the stake token wiring and ENS configuration in addition to ownership. It cross-references `config/agialpha.*.json` and `config/ens.*.json` so production runs fail fast if the contracts are bound to the wrong `$AGIALPHA` token, metadata, burn address, or ENS roots. As part of the wiring audit it also queries the stake token's ERC-20 metadata to ensure the symbol, name, and decimals cached in configuration match what the token contract reports on-chain, catching misconfigured deployments before they advance.

The script defaults to the local development network. Override it by setting `NETWORK` before invoking the command, for example:

```bash
NETWORK=sepolia npm run wire:verify
```

### Verify registrar pricing

Confirm the `ForeverSubdomainRegistrar` wiring uses the production `$AGIALPHA` token for both agent and club subdomains and enforces the required alpha tier price floor:

```bash
npm run registrar:verify
```

The verifier reads `config/registrar.<variant>.json` and checks that every configured ENS root is active on the registrar, has a live pricer, and quotes the expected ERC-20 payment token. When `minPrice` thresholds are defined for specific labels (for example `alpha.club.agi.eth` requiring 5,000 `$AGIALPHA`), the command fails if the registrar returns a lower amount. Use `NETWORK=mainnet npm run registrar:verify` to audit the production deployment prior to go-live.

## Release checklist

1. Run the full CI matrix locally (`npm run lint`, `npm run test`, `npm run coverage`, `npm run config:validate`) to catch
   regressions before tagging.
2. Export refreshed addresses/ABIs with `npm run export:artifacts` and publish them under `artifacts-public/` for integrators.
3. Bump `package.json` and `CHANGELOG.md` to the next semantic version (for example, `v1.1.0` for the pause feature rollout) and
   create a signed git tag once CI is green.
4. Update `docs/mainnet-deployment-simulation.md` with live transaction hashes, Safe execution links, and the final
   `alphaEnabled` state after the deployment or Alpha Club activation.

### GitHub Actions secrets

Deployments from CI require the following repository secrets so migrations can transfer ownership correctly:

- `MNEMONIC` — Deployer account seed phrase.
- `RPC_SEPOLIA` — HTTPS RPC endpoint for Sepolia.
- `ETHERSCAN_API_KEY` — API key for contract verification.
- `GOV_SAFE` — Destination Safe that receives ownership of deployed contracts.
- `TIMELOCK_ADDR` — Optional timelock admin that will be configured on modules supporting it.

## Governance

All privileged ownership is transferred to a Safe and timelock during migrations. See `/audit/threat-model.md` for expectations and emergency guidance.

### Emergency pause

The following owner-controlled modules expose `pause()` / `unpause()` guards:

- `StakeManager`
- `JobRegistry`
- `DisputeModule`
- `ReputationEngine`

Post-migration the governance Safe (or configured timelock) is the sole owner, so it is the only entity that can invoke these toggles. Pausing suspends new deposits, job lifecycle progression, and dispute hooks, but `StakeManager.withdraw` (worker-controlled) and `StakeManager.emergencyRelease` (governance-controlled) remain callable so stakers can exit while mitigations are prepared. Document the reason for any pause, the Safe execution links, and downstream communications in `docs/mainnet-deployment-simulation.md` immediately after taking action so auditors and incident responders have a single source of truth.

## Security

Responsible disclosure guidelines live in `SECURITY.md`. CI gates cover linting, unit tests, coverage, Slither, and Echidna smoke testing.
