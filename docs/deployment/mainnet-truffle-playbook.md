# Ethereum Mainnet Deployment Playbook (Truffle)

This playbook walks a non-technical operator through preparing, rehearsing, and executing a
production deployment of the AGIJobs v1 protocol on Ethereum Mainnet using Truffle. The flow is
designed to be checklist-driven so that each step is auditable and repeatable by compliance teams.

> **TL;DR** – run `npm run deploy:checklist`, rehearse on Sepolia, then execute `npm run migrate:mainnet`
> once every preflight item is green.

## 1. Prerequisites

| Requirement | Why it matters |
| --- | --- |
| Node.js 18+ and npm | Matches the versions used in CI and local testing. |
| Git + the `main` branch of this repository | Ensures you are using the audited release. |
| A secure workstation with hardware wallet access | The mnemonic controls protocol ownership. |
| Access to an Ethereum Mainnet RPC (Infura, Alchemy, QuickNode…) | Required for Truffle migrations. |
| A governance multisig address (Gnosis Safe recommended) | Receives contract ownership at the end of the run. |
| Optional timelock/operations contract | Grants day-to-day control if desired. |
| ENS operator access (only when ENS integration is enabled) | Allows updating ENS name wrappers. |
| ETH and AGI Alpha tokens in the deployer wallet | Covers gas fees and seed liquidity for rehearsals. |

### Files to review and customize

All configuration lives in JSON files under `config/`:

* `config/agialpha.mainnet.json` – staking token address, decimals, burn address, metadata.
* `config/ens.mainnet.json` – ENS registry + name wrapper addresses and root namehashes.
* `config/registrar.mainnet.json` – ENS registrar wiring (optional, used when ENS is enabled).
* `config/params.json` – protocol timings, quorum thresholds, fees, and slashing settings shared
  across networks.

The repository ships with canonical production defaults. Only change these values with
multi-stakeholder approval and re-run the validation script after every edit.

## 2. Prepare the environment

1. Copy `.env.example` to `.env` (or export variables directly in the shell).
2. Populate at minimum:
   ```ini
   MNEMONIC="twelve word seed phrase stored in password manager"
   RPC_MAINNET="https://mainnet.infura.io/v3/<project-id>"
   GOV_SAFE="0xMultisigAddress"
   ETHERSCAN_API_KEY="<api key for verification>"
   ```
3. Optional but strongly encouraged:
   ```ini
   RPC_SEPOLIA="https://sepolia.infura.io/v3/<project-id>"
   TIMELOCK_ADDR="0xOperationsTimelock"
   ```
4. Never paste the mnemonic in plain text terminals. Use a secure shell with history disabled or
   rely on environment managers such as `direnv`.

## 3. Run the automated preflight checklist

From the repository root:

```bash
npm install
npm run deploy:checklist
```

The checklist performs three things:

1. Verifies all mandatory environment variables are present and well-formed.
2. Prints a snapshot of the mainnet configuration files for an additional human check.
3. Executes `scripts/validate-config.js` against the selected network (defaults to mainnet).

Resolve any red ✖ markers before moving forward. You can pass another variant (e.g. `dev` or
`sepolia`) to rehearse with test parameters:

```bash
npm run deploy:checklist -- sepolia
```

## 4. Compile and rehearse on Sepolia (recommended)

1. `npm run build`
2. `npm run migrate:sepolia`
3. `npm run wire:verify -- NETWORK=sepolia`
4. `npm run owner:wizard -- NETWORK=sepolia`

Document every transaction hash and keep the output in the deployment dossier. This dry run serves
as the formal dress rehearsal and lets the owner practice the governance tooling.

## 5. Execute the mainnet deployment

With all rehearsals complete and approvals in place:

1. **Final validation** – run `npm run deploy:checklist` once more to confirm the environment.
2. **Compile** – `npm run build`
3. **Deploy** – `npm run migrate:mainnet`
4. **Sanity check** – `npm run wire:verify -- NETWORK=mainnet`
5. **Ownership audit** – `npm run owner:wizard -- NETWORK=mainnet`

Truffle will execute the migrations in order:

1. `0_local_sim_setup.js` – no-op on mainnet.
2. `1_initial_migration.js` – records the deployment and is idempotent.
3. `2_deploy_protocol.js` – deploys all core contracts. Uses the staking token address from
   `agialpha.mainnet.json`.
4. `3_wire_protocol.js` – connects modules, wires fee recipients, sets timings and thresholds from
   `params.json`.
5. `4_configure_ens_and_params.js` – optionally integrates ENS when hashes are provided.
6. `5_transfer_ownership.js` – hands ownership to the `GOV_SAFE` address and optional timelock.

Every migration emits clear console logs. Save them in the deployment dossier alongside the final
`build/contracts/*.json` artifacts.

## 6. Post-deployment tasks

1. **Verify sources** – `npm run verify:mainnet`
2. **Publish ABI bundle** – `npm run export:artifacts NETWORK=mainnet`
3. **Record governance metadata** – persist the addresses from `artifacts-public/<network>.json`.
4. **Enable monitoring** – point alerting at the deployed addresses and track fee pool balances.
5. **Run job owner controls** – if any jobs existed during migration, extend or finalize them using
   `npm run owner:wizard`.
6. **Back up** – archive the `.env` file, deployment outputs, and governance approvals in secure
   storage.

## 7. Operational control surface (owner capabilities)

The protocol is designed so the owner (multisig) can safely update or recover every critical
parameter:

| Contract | Key functions | Purpose |
| --- | --- | --- |
| `JobRegistry` | `setModules`, `updateModule` | Swap Identity/Stake/Fee/Dispute modules as the platform evolves. |
| | `setTimings`, `updateTiming` | Tune commit/reveal/dispute windows without redeploying. |
| | `setThresholds`, `updateThreshold` | Adjust quorum, fees, slashing and approval thresholds. |
| | `extendJobDeadlines`, `finalizeJob`, `raiseDispute`, `resolveDispute`, `timeoutJob` | Manage live jobs and disputes. |
| `StakeManager` | `updateJobRegistry`, `setFeeRecipient`, `emergencyRelease` | Migrate registries, rotate fee recipients, or recover user funds. |
| `FeePool` | `updateJobRegistry`, `withdrawFees` | Redirect fee routing or evacuate pooled fees. |
| `IdentityRegistry` | `configureEns`, `setValidationModule`, `setIdentityAdmin` | Maintain identity proofs and ENS integration. |
| `ReputationEngine` | `setJobRegistry`, `setEvaluator`, `batchAdjustReputation` | Maintain trust signals and respond to disputes. |
| `DisputeModule` | `setJobRegistry`, `setArbiter`, `setSlashBps` | Update dispute authority and penalties. |
| `ValidationModule` | `setJobRegistry`, `setValidator`, `setApprovalThreshold` | Adjust validation logic and quorum requirements. |

Use the pre-built wizards for guided execution:

```bash
npm run owner:wizard -- NETWORK=mainnet
npm run owner:console -- NETWORK=mainnet
npm run config:wizard -- NETWORK=mainnet
```

These scripts present human-readable menus, confirm the expected state, and only submit a
transaction after explicit confirmation. They are safe to run in read-only mode (`--interactive=false`)
for audits.

## 8. Incident response and recovery

* **Pause the system:** `JobRegistry.pause()` and `StakeManager.pause()` (via the owner console).
* **Emergency release of stake:** `StakeManager.emergencyRelease()` for affected accounts.
* **Swap compromised modules:** Deploy a fresh module and call `JobRegistry.updateModule`.
* **Restore ENS:** Re-run `npm run configure:registry -- NETWORK=mainnet` after updating the ENS
  configuration files.

Always document the incident timeline, transactions, and the root-cause analysis for stakeholders.

## 9. Compliance checklist

* ✅ Deployment dossier stored in secure knowledge base.
* ✅ Multisig signers acknowledge receipt of ownership and timelock permissions.
* ✅ Monitoring alerts configured for stake balances, fee pool balances, and JobRegistry pauses.
* ✅ ENS records updated and verified (if applicable).
* ✅ Incident response runbook reviewed quarterly.

Following this playbook ensures that even a non-technical operations team can execute a safe,
repeatable, and auditable mainnet deployment.
