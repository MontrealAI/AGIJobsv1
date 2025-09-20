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
```

`npm run coverage` enforces a 90% minimum threshold across lines, branches, and functions to match our CI gate. When the CI workflow has access to the repository `CODECOV_TOKEN` secret (for pushes and internal branches), it uploads `coverage/lcov.info` to Codecov so the badge above reflects the latest main-branch run automatically, even for private mirrors; forked pull requests skip the upload without failing the build.

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
- `config/params.json` — Commit/reveal/dispute windows and governance thresholds.
- Run `npm run config:validate` after editing to confirm addresses, namehashes, and governance parameters satisfy production
  guardrails before broadcasting migrations.

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
