#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="artifacts-public/flat"
CONTRACTS_DIR="contracts"

mkdir -p "${OUTPUT_DIR}"

shopt -s nullglob
contracts=("${CONTRACTS_DIR}"/*.sol)

if [ ${#contracts[@]} -eq 0 ]; then
  echo "No Solidity contracts found in ${CONTRACTS_DIR}."
  exit 0
fi

for contract in "${contracts[@]}"; do
  filename=$(basename "${contract}")
  flat_name="${filename%.sol}.flat.sol"
  echo "Flattening ${contract} -> ${OUTPUT_DIR}/${flat_name}"
  npx --yes truffle-flattener "${contract}" > "${OUTPUT_DIR}/${flat_name}"
done

