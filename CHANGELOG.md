# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Guided JobRegistry owner wizard with interactive and non-interactive modes, plan exports, and broadcast safeguards.

## [1.1.0] - 2025-02-21

### Added

- Protocol-wide pause controls and state export so operators can halt job lifecycle actions during incidents.

### Changed

- Alpha ENS configuration now respects the feature flag to prevent accidental registry writes in downstream environments.
- Expanded deployment and operations docs with the latest pause drill and ENS wiring guidance.
- Hardened `IdentityRegistry.configureEns` so Alpha Club activation requires a non-zero `alphaClubRootHash`, preventing accidental
  launches without the premium ENS root configured.
