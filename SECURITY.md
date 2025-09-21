# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities via email to security@montreal.ai. Use encrypted channels when possible and provide a concise proof-of-concept along with impact assessment. We aim to acknowledge reports within 48 hours and provide remediation timelines within five business days.

## Scope

All Solidity smart contracts, deployment scripts, and configuration files within this repository are in scope. Infrastructure supporting automated deployments (CI workflows, scripts) are also in scope.

## Handling

1. Confirm the report and establish a secure communication channel.
2. Reproduce the issue privately and develop a fix.
3. Coordinate disclosure timelines with the reporter.
4. Release patched versions and document mitigations.

We appreciate responsible disclosure and do not offer bug bounties at this time.

## Operational response expectations

- **Emergency pause.** Only the governance Safe (or configured timelock) can invoke the pausable module guards. When a pause is triggered, capture the Safe execution link, describe the motivating incident, and update `docs/mainnet-deployment-simulation.md` so stakeholders can audit the chronology. Workers retain access to `StakeManager.withdraw` during a pause, and governance can invoke `StakeManager.emergencyRelease` to facilitate controlled exits.
- **Alpha Club activation.** Flipping `IdentityRegistry.configureEns(..., /*alphaEnabled=*/true)` marks premium `alpha.club.agi.eth` labels as officially supported. Record the transaction hash and resulting registry state in the deployment log immediately so integrators can confirm the tier is live.
- **Post-incident recovery.** After unpausing or modifying ENS configuration, rerun the wiring checks (`npm run wire:verify`) and export refreshed artifacts with `npm run export:artifacts` to keep public ABIs/addresses in sync with production.
