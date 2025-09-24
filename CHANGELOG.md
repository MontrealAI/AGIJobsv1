# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Guided JobRegistry owner wizard with interactive and non-interactive modes, plan exports, and broadcast safeguards.
- Hardhat `job-registry:set-config` and `job-registry:update-config` tasks that mirror the configuration console with JSON
  overrides, plan exports, and owner enforcement.
- Hardhat `identity-registry:status` and `identity-registry:set-config` tasks so ENS owners can audit and update wiring without
  leaving the Hardhat workflow.
- IdentityRegistry emergency access console (`npm run identity:emergency`) with Safe-ready planning, checksum validation, and
  sequential broadcast support for multi-step updates.
- Hardhat emergency management tasks (`identity-registry:emergency-status` / `identity-registry:set-emergency`) that surface
  allow-list drift, generate multisig payloads, and enforce owner-only execution before broadcasting.
- StakeManager owner console (`npm run stake:console`) with pause controls, registry wiring helpers, Safe-ready plan exports,
  and human-readable emergency release tooling for non-technical operators.

## [1.1.0] - 2025-02-21

### Added

- Protocol-wide pause controls and state export so operators can halt job lifecycle actions during incidents.

### Changed

- Alpha ENS configuration now respects the feature flag to prevent accidental registry writes in downstream environments.
- Expanded deployment and operations docs with the latest pause drill and ENS wiring guidance.
- Hardened `IdentityRegistry.configureEns` so Alpha Club activation requires a non-zero `alphaClubRootHash`, preventing accidental
  launches without the premium ENS root configured.
