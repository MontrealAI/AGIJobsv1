# AGIJobsv1 — Protocol-Only (Truffle)

Institutional-grade, ENS-gated job coordination protocol. Contracts only: Solidity, Truffle migrations, tests, CI.

## Quickstart

```bash
npm ci
npm run build
npm run test
npm run coverage
```

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
