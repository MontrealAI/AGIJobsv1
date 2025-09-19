# AGIJobsv1 — Protocol-Only (Truffle)

Institutional-grade, ENS-gated job coordination protocol. Contracts only: Solidity, Truffle migrations, tests, CI.

## Quickstart

```bash
npm ci
npm run build
npm run test
npm run coverage
```

`npm run coverage` enforces a 90% minimum threshold across lines, branches, and functions to match our CI gate.

## Configure

```bash
cp .env.example .env
# set MNEMONIC, RPCs, ETHERSCAN_API_KEY, GOV_SAFE, TIMELOCK_ADDR
```

Edit configuration files under `config/` to match the deployment environment:

- `config/agialpha.json` — ERC-20 token parameters and burn address.
- `config/ens.json` — ENS registry and subdomain roots (run `npm run namehash`).
- `config/params.json` — Commit/reveal/dispute windows and governance thresholds.

## Mainnet deployment profile

The repository is pre-configured for Ethereum mainnet and the production $AGIALPHA stake token. Confirm the following addresses
before migrating:

| Component | Value |
| --- | --- |
| Stake token (`$AGIALPHA`) | `0xA61a3B3a130a9c20768EEBF97E21515A6046a1fA` |
| Token decimals | `18` |
| Stake burn address | `0x000000000000000000000000000000000000dEaD` |
| ENS registry | `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` |
| Agent ENS root | `agent.agi.eth` (`0x2c9c6189b2e92da4d0407e9deb38ff6870729ad063af7e8576cb7b7898c88e2d`) |
| Club ENS root | `club.agi.eth` (`0x39eb848f88bdfb0a6371096249dd451f56859dfe2cd3ddeab1e26d5bb68ede16`) |

Operational parameters shipped in `config/params.json` align with the governance-approved mainnet timings:

| Parameter | Value | Notes |
| --- | --- | --- |
| `commitWindow` | `604800` seconds | 7 days to collect worker commits. |
| `revealWindow` | `86400` seconds | 1 day for reveal submissions. |
| `disputeWindow` | `259200` seconds | 3 days for dispute escalation. |
| `approvalThresholdBps` | `6000` | 60% reveal approval threshold. |
| `quorumMin` / `quorumMax` | `3` / `11` | Bounds for validator committee size. |
| `feeBps` | `250` | 2.5% protocol fee. |
| `slashBpsMax` | `2000` | Maximum 20% slash per dispute. |

## Deploy (Sepolia)

```bash
npm run namehash
npm run migrate:sepolia
npm run verify:sepolia
npm run export:artifacts
```

`npm run export:artifacts` performs a deterministic local migration, exports network-specific addresses, and generates sanitized ABI bundles under `artifacts-public/`. Use `npm run export:abis` when you only need to refresh the ABI manifest after a compile.

## Verify wiring

Run the wiring checker to confirm deployed contract addresses match the expected configuration:

```bash
npm run wire:verify
```

The script defaults to the local development network. Override it by setting `NETWORK` before invoking the command, for example:

```bash
NETWORK=sepolia npm run wire:verify
```

### GitHub Actions secrets

Deployments from CI require the following repository secrets so migrations can transfer ownership correctly:

- `MNEMONIC` — Deployer account seed phrase.
- `RPC_SEPOLIA` — HTTPS RPC endpoint for Sepolia.
- `ETHERSCAN_API_KEY` — API key for contract verification.
- `GOV_SAFE` — Destination Safe that receives ownership of deployed contracts.
- `TIMELOCK_ADDR` — Optional timelock admin that will be configured on modules supporting it.

## Governance

All privileged ownership is transferred to a Safe and timelock during migrations. See `/audit/threat-model.md` for expectations and emergency guidance.

## Security

Responsible disclosure guidelines live in `SECURITY.md`. CI gates cover linting, unit tests, coverage, Slither, and Echidna smoke testing.
