# Contributing Guidelines

Thank you for your interest in contributing to AGIJobsv1. This repository hosts the protocol smart contracts, migrations, and associated tooling.

## Development Environment

- Node.js 20.x (see `.nvmrc`).
- NPM v10+.
- Truffle CLI (installed via `npm ci`).
- A local Ethereum JSON-RPC endpoint for development (Ganache, Hardhat node, or Foundry Anvil).

## Workflow

1. Fork the repository and create a feature branch from `main`.
2. Install dependencies with `npm ci`.
3. Run `npm run build` and ensure compilation succeeds.
4. Add or update unit tests with `npm run test` and `npm run coverage` (the coverage gate enforces ≥90% across lines, branches, and functions).
5. Run static analysis: `npm run lint:sol` and applicable security tooling.
6. Submit a pull request describing the motivation and testing performed.

All contributions require review from the CODEOWNERS and must pass CI.

## Commit Messages

We enforce [Conventional Commits](https://www.conventionalcommits.org/). Commit messages should follow the pattern:

```
<type>(<scope>): <short summary>
```

Use imperative mood and keep the summary under 72 characters. Examples: `feat: add staking slashing bounds`, `fix(test): stabilize gas assertions`.

## Coding Standards

- Solidity files must include SPDX identifiers and use pragma `^0.8.20` or the locked compiler version defined in `truffle-config.js`.
- Run `npm run fmt` before committing to ensure consistent formatting.
- Keep functions short and focused; prefer descriptive revert messages.
- Add NatSpec comments to public and external functions.

## Security Considerations

Do not submit exploit details publicly. Use the security contact defined in `SECURITY.md`.
