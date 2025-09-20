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

In this simulation the `.env` file was not written. Confirm locally that `truffle-config.js` can resolve these variables before broadcasting transactions.

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

## 3. Artifact export

After migrations succeed, run:

```bash
npm run export:artifacts
```

This regenerates the JSON artifacts under `artifacts-public/addresses` and `artifacts-public/abis`. Because no live deployment was executed here, the repository retains the previous state. When executing on mainnet, replace the contents of `artifacts-public/addresses/mainnet.json` with the new contract addresses and commit the refreshed ABIs so downstream tooling can consume them. The existing file reflects the last known deployment and serves as a baseline for comparison during the real rollout.

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

## 6. Next steps for production

1. Run the sequence above against mainnet with live credentials.
2. Commit the updated artifacts and deployment notes.
3. Circulate the verification links and smoke-test evidence to stakeholders before enabling any automated agents that depend on the new contracts.

_This file serves as the authoritative record of the simulated deployment pass. Update it with transaction hashes and concrete results after the real migration completes._
