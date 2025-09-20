const { readConfig, resolveVariant } = require('./config-loader');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const DEFAULT_DURATION = 31_536_000; // 365 days

const REGISTRAR_ABI = [
  {
    constant: true,
    inputs: [{ name: '', type: 'bytes32' }],
    name: 'names',
    outputs: [
      { name: 'pricer', type: 'address' },
      { name: 'beneficiary', type: 'address' },
      { name: 'active', type: 'bool' },
    ],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
];

const PRICER_ABI = [
  {
    constant: true,
    inputs: [
      { name: 'parentNode', type: 'bytes32' },
      { name: 'label', type: 'string' },
      { name: 'duration', type: 'uint256' },
    ],
    name: 'price',
    outputs: [
      { name: 'token', type: 'address' },
      { name: 'price', type: 'uint256' },
    ],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
];

function extractNetwork(argv) {
  const networkFlagIndex = argv.findIndex((arg) => arg === '--network');
  if (networkFlagIndex !== -1 && argv[networkFlagIndex + 1]) {
    return argv[networkFlagIndex + 1];
  }

  return undefined;
}

function normalizeHex(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.toLowerCase();
}

function normalizeLabel(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function toBigInt(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`Expected integer but received ${value}`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string') {
    if (!/^\d+$/.test(value)) {
      throw new Error(`Expected decimal string but received "${value}"`);
    }
    return BigInt(value);
  }
  throw new Error(`Unsupported numeric type ${typeof value}`);
}

function resolveNode(domainConfig, ensConfig) {
  if (domainConfig.node) {
    return normalizeHex(domainConfig.node);
  }
  if (domainConfig.rootKey) {
    const key = domainConfig.rootKey;
    const value = ensConfig ? ensConfig[key] : undefined;
    if (typeof value === 'string') {
      return normalizeHex(value);
    }
  }
  return null;
}

async function ensurePrice({
  web3,
  pricerAddress,
  parentNode,
  label,
  expectedToken,
  minPrice,
  maxPrice,
  duration,
}) {
  const pricer = new web3.eth.Contract(PRICER_ABI, pricerAddress);
  try {
    const result = await pricer.methods.price(parentNode, label, duration.toString()).call();
    const token = normalizeHex(result.token);
    const price = BigInt(result.price);

    if (expectedToken && token !== expectedToken) {
      throw new Error(
        `Price check token mismatch for label "${label}" on ${parentNode}: expected ${expectedToken} but got ${token}`
      );
    }

    if (minPrice !== null && price < minPrice) {
      throw new Error(
        `Price for label "${label}" on ${parentNode} is below minimum (${price.toString()} < ${minPrice.toString()})`
      );
    }

    if (maxPrice !== null && price > maxPrice) {
      throw new Error(
        `Price for label "${label}" on ${parentNode} exceeds maximum (${price.toString()} > ${maxPrice.toString()})`
      );
    }

    return { token, price };
  } catch (error) {
    if (error && error.message) {
      throw new Error(`Failed to query price for label "${label}" on ${parentNode}: ${error.message}`);
    }
    throw error;
  }
}

async function verifyDomain({ web3, registrar, domainConfig, ensConfig, defaultToken, logger }) {
  const node = resolveNode(domainConfig, ensConfig);
  if (!node) {
    throw new Error(`Domain entry ${domainConfig.name || 'unknown'} is missing a resolvable node hash`);
  }

  const info = await registrar.methods.names(node).call();
  const pricerAddress = normalizeHex(info.pricer);
  const beneficiary = normalizeHex(info.beneficiary);
  const active = Boolean(info.active);

  if (!active) {
    throw new Error(`Domain ${domainConfig.name || node} is not active on registrar`);
  }

  if (!pricerAddress || pricerAddress === ZERO_ADDRESS) {
    throw new Error(`Domain ${domainConfig.name || node} is missing an assigned pricer`);
  }

  if (domainConfig.expectedBeneficiary) {
    const expected = normalizeHex(domainConfig.expectedBeneficiary);
    if (!expected) {
      throw new Error(`expectedBeneficiary for ${domainConfig.name || node} is not a valid address`);
    }
    if (beneficiary !== expected) {
      throw new Error(
        `Beneficiary mismatch for ${domainConfig.name || node}: expected ${expected} but found ${beneficiary}`
      );
    }
  }

  const labels = Array.isArray(domainConfig.labels) ? domainConfig.labels : [];
  const domainLabel = domainConfig.name || node;
  const results = [];

  if (labels.length === 0 && logger) {
    logger.log(`Domain ${domainLabel} active with pricer ${pricerAddress}; no label checks configured.`);
  }

  for (const entry of labels) {
    const label = normalizeLabel(entry.label);
    if (!label) {
      throw new Error(`Label entry for domain ${domainLabel} is missing a valid label string`);
    }

    const expectedToken = normalizeHex(entry.expectedToken || domainConfig.expectedToken || defaultToken);
    const minPrice = entry.minPrice !== undefined && entry.minPrice !== null ? toBigInt(entry.minPrice) : null;
    const maxPrice = entry.maxPrice !== undefined && entry.maxPrice !== null ? toBigInt(entry.maxPrice) : null;
    const durationSource =
      entry.duration !== undefined && entry.duration !== null
        ? entry.duration
        : domainConfig.defaultDuration !== undefined
        ? domainConfig.defaultDuration
        : DEFAULT_DURATION;
    const duration = toBigInt(durationSource);

    const { token, price } = await ensurePrice({
      web3,
      pricerAddress,
      parentNode: node,
      label,
      expectedToken,
      minPrice,
      maxPrice,
      duration,
    });

    if (logger) {
      const descriptor = [`token ${token || 'unknown'}`, `price ${price.toString()}`];
      logger.log(`Domain ${domainLabel} label "${label}" verified (${descriptor.join(', ')})`);
    }

    results.push({ label, token, price, duration });
  }

  return { node, pricer: pricerAddress, beneficiary, labels: results };
}

async function verifyRegistrar({ web3, network, config, ensConfig, logger = console }) {
  if (!config || typeof config !== 'object') {
    throw new Error('Registrar configuration must be an object');
  }

  const address = normalizeHex(config.address);
  if (!address || address === ZERO_ADDRESS) {
    if (logger) {
      logger.log('Registrar address is not configured for this network; skipping verification.');
    }
    return { skipped: true };
  }

  const registrar = new web3.eth.Contract(REGISTRAR_ABI, address);
  const defaultToken = normalizeHex(config.defaultToken);
  const domains = Array.isArray(config.domains) ? config.domains : [];

  if (domains.length === 0 && logger) {
    logger.log('No registrar domains configured; nothing to verify.');
  }

  const results = [];
  for (const domain of domains) {
    const outcome = await verifyDomain({ web3, registrar, domainConfig: domain, ensConfig, defaultToken, logger });
    results.push(outcome);
  }

  if (logger) {
    logger.log(`Registrar ${address} verification complete (${results.length} domain checks).`);
  }

  return { skipped: false, results };
}

module.exports = async function (callback) {
  try {
    const networkName = extractNetwork(process.argv) || process.env.NETWORK || process.env.TRUFFLE_NETWORK;
    const variant = resolveVariant(networkName);
    const registrarConfig = readConfig('registrar', variant);
    const ensConfig = readConfig('ens', variant);
    await verifyRegistrar({ web3, network: variant, config: registrarConfig, ensConfig, logger: console });
    callback();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
    callback(error);
  }
};

module.exports.verifyRegistrar = verifyRegistrar;
module.exports._internal = {
  extractNetwork,
  normalizeHex,
  normalizeLabel,
  resolveNode,
  toBigInt,
  ensurePrice,
  verifyDomain,
};
