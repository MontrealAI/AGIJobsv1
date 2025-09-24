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
- Hardhat `dispute-module:*` task suite for registry wiring, pause management, and Safe-ready plan exports with owner
  enforcement.
- Hardhat `validation-module:*` tooling that normalizes rule identifiers (including file-based inputs), generates Safe-ready
  payloads, and blocks no-op broadcasts unless `--force` is supplied.

### Fixed

- Ensure Hardhat eagerly loads the IdentityRegistry task definitions so the documented `identity-registry:*` CLI commands work
  without requiring manual imports in downstream scripts.

## [1.1.0] - 2025-02-21

### Added

- Protocol-wide pause controls and state export so operators can halt job lifecycle actions during incidents.

### Changed

- Alpha ENS configuration now respects the feature flag to prevent accidental registry writes in downstream environments.
- Expanded deployment and operations docs with the latest pause drill and ENS wiring guidance.
- Hardened `IdentityRegistry.configureEns` so Alpha Club activation requires a non-zero `alphaClubRootHash`, preventing accidental
  launches without the premium ENS root configured.
