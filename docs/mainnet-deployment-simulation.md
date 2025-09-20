# Mainnet Deployment Simulation Log

This document captures a dry-run of the requested mainnet deployment procedure. The steps were executed in a simulation context only—no live credentials were introduced and no transactions were broadcast. Use this write-up as a checklist when performing the actual deployment.

## 1. Environment preparation

Populate a local `.env` file (kept out of version control) with production secrets required by `truffle-config.js`. The template in `.env.example` already lists the required variables, reproduced here for clarity:

```
MNEMONIC="<production wallet seed phrase>"
RPC_MAINNET="https://mainnet.infura.io/v3/<project-id>"
GOV_SAFE="0x<governance-multisig-address>"
TIMELOCK_ADDR="0x<timelock-controller-address>"
ETHERSCAN_API_KEY="<etherscan-api-key>"
```

`truffle-config.js` consumes each of these keys to configure the mainnet provider and the verification plugin, so missing values will abort migrations before any transaction is signed.【F:truffle-config.js†L1-L32】 In this simulation run the `.env` file was not written; validate the resolved values locally with `node -e "require('dotenv').config(); console.log(process.env)"` before connecting to mainnet.

## 2. Migration dry-run

From the repository root the following command was staged:

```bash
truffle migrate --reset --network mainnet
```

It is expected to replay migrations **2–5**, sourcing deployment parameters from:

- `config/agialpha.json`
- `config/ens.json`
- `config/params.json`

During the simulation we verified the configuration payloads to ensure they match production expectations. `config/agialpha.json` pins the live staking token, decimals, and burn address, `config/ens.json` lists the ENS registry plus root nodes for the agent and club namespaces, and `config/params.json` records the governance timing and quorum values. When running against mainnet ensure:

- The deploying account has sufficient ETH for gas.
- Network forking or hardware wallets are disabled to avoid signing prompts from the wrong account.
- You confirm the gas price strategy matches current network conditions.

Migrations execute in order: ownership handoff is handled in `5_transfer_ownership.js`, so confirm the deployer has permission to execute steps **2–4** before transferring control.【F:migrations/2_deploy_protocol.js†L1-L200】【F:migrations/3_wire_protocol.js†L1-L200】【F:migrations/4_configure_ens_and_params.js†L1-L200】【F:migrations/5_transfer_ownership.js†L1-L200】

## 3. Artifact export

After migrations succeed, run:

```bash
npm run export:artifacts
```

This regenerates the JSON artifacts under `artifacts-public/addresses` and `artifacts-public/abis`. Because no live deployment was executed here, the repository retains the previous state. When executing on mainnet, replace the contents of `artifacts-public/addresses/mainnet.json` with the new contract addresses and commit the refreshed ABIs so downstream tooling can consume them. The existing file reflects the last known deployment and serves as a baseline for comparison during the real rollout.【F:artifacts-public/addresses/mainnet.json†L1-L9】

The export runner (`scripts/export-artifacts-runner.js`) spins up a local Hardhat node, replays migrations against it, then writes sanitized artifacts. Ensure the `NETWORK` environment variable is set to `mainnet` before invoking the script in production so the addresses file is stamped under the correct key.【F:scripts/export-artifacts-runner.js†L1-L77】

## 4. Etherscan verification

To publish sources, execute:

```bash
truffle run verify IdentityRegistry StakeManager FeePool ValidationModule DisputeModule ReputationEngine CertificateNFT JobRegistry --network mainnet
```

Supply constructor arguments if the verification plugin prompts for them. Typical sources:

- `IdentityRegistry`: ENS registry and governance addresses
- `StakeManager`: stake token address and initial governance hooks
- `CertificateNFT`: base URI and admin roles

Record any verification URLs or transaction hashes for release notes.

If verification fails because the plugin cannot infer arguments, extract them from the Truffle artifacts after migration (`build/contracts/*.json`). The plugin pulls its API key from `ETHERSCAN_API_KEY`, so confirm the environment variable is set before retrying.【F:truffle-config.js†L1-L32】

## 5. Wiring verification & smoke tests

Validate wiring and ownership with:

```bash
NETWORK=mainnet npm run wire:verify
```

Follow up with manual spot-checks using a console or block explorer:

- `StakeManager.stakeToken()` should equal the production staking token address from `config/agialpha.json`.
- ENS root nodes configured in `config/ens.json` should resolve to the freshly deployed modules.
- Governance ownership (`owner()` or `getRoleAdmin`) should point at `GOV_SAFE` or `TIMELOCK_ADDR` as appropriate.

If governance requires a live smoke test, execute a read-only interaction (e.g., `IdentityRegistry.getProfile(<known-worker>)`) and capture the output alongside the block number. No such checks were run in this simulation.

`scripts/verify-wiring.js` enforces these invariants by loading deployed artifacts and comparing them against the governance parameters from `config/params.json`. It expects either `GOV_SAFE` or `TIMELOCK_ADDR` to be present in the environment and aborts if any module is miswired or owned by an unexpected address.【F:scripts/verify-wiring.js†L1-L82】 For interactive spot checks, attach to the deployed contracts with `truffle console --network mainnet` and run commands such as:

```
// Confirm the staking token binding
StakeManager.deployed().then(async (m) => console.log(await m.stakeToken()));

// Inspect ENS configuration via the identity registry
IdentityRegistry.deployed().then(async (r) => console.log(await r.ens()));
```

Capture transaction hashes, block numbers, and console output in this log once the live migration is complete to satisfy governance reporting requirements.

## 6. Next steps for production

1. Run the sequence above against mainnet with live credentials.
2. Commit the updated artifacts and deployment notes.
3. Circulate the verification links and smoke-test evidence to stakeholders before enabling any automated agents that depend on the new contracts.

_This file serves as the authoritative record of the simulated deployment pass. Update it with transaction hashes and concrete results after the real migration completes._
