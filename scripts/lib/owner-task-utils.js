'use strict';

const fs = require('fs');
const path = require('path');

const { serializeForJson } = require('./json-utils');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const ERC20_METADATA_ABI = [
  {
    constant: true,
    inputs: [],
    name: 'name',
    outputs: [{ name: '', type: 'string' }],
    type: 'function',
  },
  {
    constant: true,
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    type: 'function',
  },
  {
    constant: true,
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    type: 'function',
  },
  {
    constant: true,
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    type: 'function',
  },
];

function toChecksum(web3Instance, address) {
  if (!address) {
    return null;
  }

  const candidate = String(address);
  if (
    !web3Instance ||
    !web3Instance.utils ||
    typeof web3Instance.utils.toChecksumAddress !== 'function'
  ) {
    return candidate;
  }

  try {
    return web3Instance.utils.toChecksumAddress(candidate);
  } catch (error) {
    return candidate;
  }
}

function isZeroAddress(address) {
  if (!address) {
    return true;
  }
  return String(address).toLowerCase() === ZERO_ADDRESS;
}

function formatAddress(web3Instance, address) {
  if (!address || isZeroAddress(address)) {
    return '(unset)';
  }
  return toChecksum(web3Instance, address);
}

function ensureAddress(web3Instance, candidate, label) {
  if (!candidate) {
    throw new Error(`${label} address is required.`);
  }

  if (!web3Instance || !web3Instance.utils || typeof web3Instance.utils.isAddress !== 'function') {
    return candidate;
  }

  if (!web3Instance.utils.isAddress(candidate)) {
    throw new Error(`${label} address is invalid: ${candidate}`);
  }

  return toChecksum(web3Instance, candidate);
}

function ensureUint256(value, label) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${label} value is required.`);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${label} must be a non-negative integer.`);
    }
    return Math.trunc(value).toString();
  }

  const stringified = String(value).trim();
  if (!/^\d+$/.test(stringified)) {
    throw new Error(`${label} must be provided as a non-negative integer.`);
  }

  return stringified;
}

async function resolveSender(hre, explicit) {
  if (explicit) {
    return ensureAddress(hre.web3, explicit, '--from');
  }

  const accounts = await hre.web3.eth.getAccounts();
  if (!accounts || accounts.length === 0) {
    throw new Error(
      'No unlocked accounts are available. Provide --from to specify the transaction sender.'
    );
  }

  return ensureAddress(hre.web3, accounts[0], 'Default account');
}

function ensureOwner(sender, owner, contractLabel) {
  if (!owner || isZeroAddress(owner)) {
    throw new Error(`${contractLabel} owner is not configured on-chain.`);
  }

  if (sender.toLowerCase() !== owner.toLowerCase()) {
    throw new Error(
      `Sender ${sender} is not the ${contractLabel} owner (${owner}). ` +
        'Provide --from with the owner account or forward the generated plan through the owner multisig.'
    );
  }
}

function buildCallSummary({ action, method, args, metadata, contractAddress, sender, callData }) {
  return {
    action,
    method,
    args: serializeForJson(args),
    metadata: serializeForJson(metadata || {}),
    call: {
      to: contractAddress,
      data: callData,
      value: '0',
      from: sender || null,
    },
  };
}

function printPlanSummary(summary) {
  console.log('Planned transaction:');
  console.log(`  action: ${summary.action}`);
  console.log(`  to: ${summary.call.to}`);
  console.log(`  method: ${summary.method}`);
  console.log(`  args: ${JSON.stringify(summary.args, null, 2)}`);
  console.log(`  data: ${summary.call.data}`);
  if (summary.metadata && Object.keys(summary.metadata).length > 0) {
    console.log(`  metadata: ${JSON.stringify(summary.metadata, null, 2)}`);
  }
}

function maybeWriteSummary(outputPath, summary) {
  if (!outputPath) {
    return null;
  }

  const resolvedPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return resolvedPath;
}

async function callOptional(contract, method, args = []) {
  if (!contract || !contract.methods || typeof contract.methods[method] !== 'function') {
    return null;
  }

  try {
    return await contract.methods[method](...args).call();
  } catch (error) {
    return null;
  }
}

async function fetchErc20Metadata(web3Instance, tokenAddress) {
  if (!tokenAddress || isZeroAddress(tokenAddress)) {
    return null;
  }

  const contract = new web3Instance.eth.Contract(ERC20_METADATA_ABI, tokenAddress);
  const [name, symbol, decimalsRaw] = await Promise.all([
    callOptional(contract, 'name'),
    callOptional(contract, 'symbol'),
    callOptional(contract, 'decimals'),
  ]);

  let decimals = null;
  if (decimalsRaw !== null && decimalsRaw !== undefined) {
    try {
      decimals = Number(decimalsRaw);
      if (!Number.isFinite(decimals)) {
        decimals = null;
      }
    } catch (error) {
      decimals = null;
    }
  }

  return {
    name: name || null,
    symbol: symbol || null,
    decimals,
  };
}

async function readTokenBalance(web3Instance, tokenAddress, holder) {
  if (!tokenAddress || isZeroAddress(tokenAddress) || !holder) {
    return null;
  }

  const contract = new web3Instance.eth.Contract(ERC20_METADATA_ABI, tokenAddress);
  const balance = await callOptional(contract, 'balanceOf', [holder]);
  return balance !== null && balance !== undefined ? String(balance) : null;
}

function formatTokenMetadata(metadata) {
  if (!metadata) {
    return 'unavailable';
  }

  const parts = [];
  if (metadata.name) {
    parts.push(metadata.name);
  }
  if (metadata.symbol) {
    parts.push(`symbol ${metadata.symbol}`);
  }
  if (metadata.decimals !== null && metadata.decimals !== undefined) {
    parts.push(`${metadata.decimals} decimals`);
  }
  if (parts.length === 0) {
    return 'unavailable';
  }
  return parts.join(', ');
}

function formatTokenAmount(rawAmount, decimals, precision = 6) {
  if (rawAmount === null || rawAmount === undefined) {
    return 'unavailable';
  }

  const normalized = BigInt(rawAmount);
  if (decimals === null || decimals === undefined || decimals < 0) {
    return normalized.toString();
  }

  const scale = BigInt(10) ** BigInt(decimals);
  const whole = normalized / scale;
  const fraction = normalized % scale;
  if (fraction === 0n) {
    return `${normalized.toString()} (${whole.toString()})`;
  }

  const padded = fraction.toString().padStart(decimals, '0');
  const trimmed = padded.replace(/0+$/, '');
  const truncated = trimmed.length > precision ? `${trimmed.slice(0, precision)}…` : trimmed;
  return `${normalized.toString()} (${whole.toString()}.${truncated})`;
}

module.exports = {
  buildCallSummary,
  ensureAddress,
  ensureOwner,
  ensureUint256,
  fetchErc20Metadata,
  formatAddress,
  formatTokenAmount,
  formatTokenMetadata,
  maybeWriteSummary,
  printPlanSummary,
  readTokenBalance,
  resolveSender,
  toChecksum,
};
