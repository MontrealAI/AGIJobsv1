#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="artifacts-public/flat"
CONTRACTS_DIR="contracts"

mkdir -p "${OUTPUT_DIR}"

if ! command -v find >/dev/null 2>&1; then
  echo "Error: 'find' command not available in PATH." >&2
  exit 1
fi

mapfile -t contracts < <(
  find "${CONTRACTS_DIR}" -type f -name '*.sol' \
    ! -path "${CONTRACTS_DIR}/core/testing/*" \
    ! -path "${CONTRACTS_DIR}/libs/*"
)

if [ ${#contracts[@]} -eq 0 ]; then
  echo "No Solidity contracts found in ${CONTRACTS_DIR}."
  exit 0
fi

for contract in "${contracts[@]}"; do
  rel_path="${contract#${CONTRACTS_DIR}/}"

  # Skip migration artifacts that do not require verification.
  if [[ "${rel_path}" == "Migrations.sol" ]]; then
    continue
  fi

  relative_dir="$(dirname "${rel_path}")"
  if [[ "${relative_dir}" == "." ]]; then
    target_dir="${OUTPUT_DIR}"
  else
    target_dir="${OUTPUT_DIR}/${relative_dir}"
  fi
  mkdir -p "${target_dir}"

  filename="$(basename "${rel_path}")"
  flat_name="${filename%.sol}.flat.sol"
  target_path="${target_dir}/${flat_name}"

  echo "Flattening ${contract} -> ${target_path}"
  npx --yes truffle-flattener "${contract}" > "${target_path}"
done

echo "Flattened ${#contracts[@]} contract(s) into ${OUTPUT_DIR}."

