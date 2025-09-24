# StakeManager owner operations

The StakeManager owner console (`npm run stake:console`) gives governance a single entrypoint to audit and update the staking
contract. It mirrors the JobRegistry owner tooling with pause management, Safe-ready plan exports, and guardrails that prevent
common misconfigurations such as setting the JobRegistry twice or updating wiring while the contract is live.

## Prerequisites

- Unlock an owner account in your RPC endpoint or supply `--from 0xOwner` to target a specific address. The script refuses to
  broadcast transactions from non-owner accounts and always prints the sender that would be used.
- Run against a configured Truffle network (`--network development`, `--network sepolia`, etc.). The console reads deployed
  addresses from Truffle artifacts and queries the live network for current configuration.
- Install dependencies with `npm ci` before using the console directly so the repository scripts and Hardhat/Truffle toolchains
  are available.

## Quick inspection

```bash
npm run stake:console -- --network development status
```

The status action prints:

- StakeManager and owner addresses
- Pause state
- The wired JobRegistry and fee recipient (with checksum formatting)
- Stake token metadata (address, symbol, name, decimals)

This read-only action never touches the chain and is safe to execute from any account.

## Wiring the JobRegistry

Initial deployments require wiring the JobRegistry once the contracts are live:

```bash
npm run stake:console -- --network sepolia set-job-registry --job-registry 0xRegistry --plan-out ./plans/staking-set.json
```

The console validates that the StakeManager has not been wired already, encodes the call to `setJobRegistry`, and writes a Safe
plan containing the calldata. Add `--execute --from 0xOwner` to broadcast immediately; otherwise hand the JSON plan to a multisig
operator.

When migrating governance to a new registry deployment, the StakeManager must be paused first:

```bash
npm run stake:console -- --network mainnet pause --execute --from 0xOwner
npm run stake:console -- --network mainnet update-job-registry --job-registry 0xNewRegistry --execute --from 0xOwner
```

The console refuses to call `updateJobRegistry` unless the contract is paused and the new address differs from the current one.

## Fee recipient management

Slash proceeds flow to the address configured via `setFeeRecipient`:

```bash
npm run stake:console -- --network sepolia set-fee-recipient --fee-recipient 0xFeeSafe --plan-out ./plans/fee-update.json
```

Dry runs log the calldata and Safe-ready plan to help multisig operators stage the transaction. Add `--execute --from 0xOwner`
when you are ready to broadcast.

## Pause and unpause

`pause` and `unpause` are exposed directly so incident response checklists can be executed without hand-crafting calldata:

```bash
npm run stake:console -- --network mainnet pause --execute --from 0xOwner
npm run stake:console -- --network mainnet unpause --execute --from 0xOwner
```

The console skips execution when the StakeManager is already in the desired state to avoid accidental gas spending.

## Emergency release workflow

Governance can recover stake without the JobRegistry by calling `emergencyRelease`. The console accepts either raw integers via
`--amount` or human-readable token amounts via `--amount-human` and converts the value using the token decimals stored on-chain.

```bash
npm run stake:console -- --network mainnet emergency-release --account 0xWorker --amount-human 125.5 --plan-out ./plans/release.json
```

The plan summary includes both the raw integer and the decoded token amount so reviewers understand the stake quantity without
recomputing decimals manually. The command refuses to broadcast amounts of zero, enforces checksum formatting on addresses, and
requires ownership before sending the transaction.

## Safe-ready plan exports

All mutating actions accept `--plan-out ./path/to/plan.json` to persist a JSON payload with:

- Contract address and method name
- Encoded calldata (`to`/`data`/`value`)
- Argument summaries (including human-readable emergency release amounts)
- Current StakeManager context (owner, pause status, wiring, stake token metadata)

These plans feed directly into multisig pipelines or deployment runbooks so non-technical operators can validate the payload
before signing.

## Troubleshooting

- **"Sender is not the StakeManager owner"** — Unlock the governance account locally or provide `--from 0xOwner` explicitly.
- **"StakeManager already references a JobRegistry"** — Use `update-job-registry` instead of `set-job-registry` and pause the
  contract first. The console prevents accidental overrides that would otherwise revert on-chain.
- **"Token amount precision exceeds stake token decimals"** — Adjust the `--amount-human` value to use no more than the number of
  decimals configured for the stake token (18 on mainnet).
- **Unexpected RPC errors** — Confirm your RPC endpoint is running and that the Truffle network name matches a configured
  provider in `truffle-config.js`.
