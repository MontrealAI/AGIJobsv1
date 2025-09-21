# Threat Model Overview

This document outlines key assumptions and mitigations for the AGIJobsv1 protocol deployment.

## Assets

- Worker stakes held within `StakeManager`.
- Governance privileged operations controlled by the Safe address.
- ENS identity linkage ensuring only authorised participants can interact with restricted flows.

## Adversaries

- **Malicious Worker** attempting to bypass staking requirements or exit with locked funds.
- **Malicious Client** trying to slash workers outside dispute rules.
- **Key Compromise** of governance or emergency keys.

## Controls

- Ownership transferred to a multisig Safe via migration `5_transfer_ownership.js`.
- Timelock address (if provided) required for parameter mutation.
- Emergency allow list limited to explicitly set addresses in `IdentityRegistry`.
- StakeManager exposes a governance-only emergency release path to unlock stuck worker stake without touching balances.
- Protocol-wide pause capability halts new lifecycle invocations during incidents while preserving recovery flows through `StakeManager`.
- Unit tests cover lifecycle happy paths and dispute resolution bounds.
- Static analysis (Solhint, Slither) and fuzzing (Echidna smoke) wired via CI.

## Residual Risks

- Off-chain components (Safe, ENS) must be configured correctly by deployment operators.
- Governance timelock delay must be calibrated for stakeholder response time.
- Paused operations require coordinated response to resume activity and complete any queued job settlements.
