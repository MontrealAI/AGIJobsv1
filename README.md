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
