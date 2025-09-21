const fs = require('fs');
const path = require('path');
const { hash: namehash } = require('eth-ens-namehash');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const AGI_MAINNET_TOKEN = '0xA61a3B3a130a9c20768EEBF97E21515A6046a1fA';
const AGI_MAINNET_BURN = '0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000';
const ENS_MAINNET_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const ENS_MAINNET_NAME_WRAPPER = '0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401';
const HEX_32_REGEX = /^0x[0-9a-fA-F]{64}$/;

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function isAddress(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function equalsIgnoreCase(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}

function addError(errors, fileLabel, message) {
  errors.push(`${fileLabel}: ${message}`);
}

function ensureString(errors, fileLabel, object, key, { required = false, nonEmpty = false } = {}) {
  const value = object[key];

  if (value === null || value === undefined) {
    if (required) {
      addError(errors, fileLabel, `${key} must be provided`);
    }
    return null;
  }

  if (typeof value !== 'string') {
    addError(errors, fileLabel, `${key} must be a string`);
    return null;
  }

  if (nonEmpty && value.trim().length === 0) {
    addError(errors, fileLabel, `${key} must not be empty`);
  }

  return value;
}

function ensureInteger(errors, fileLabel, object, key, { min, max, positive } = {}) {
  const value = object[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    addError(errors, fileLabel, `${key} must be an integer number`);
    return null;
  }

  if (positive && value <= 0) {
    addError(errors, fileLabel, `${key} must be greater than zero`);
  }

  if (typeof min === 'number' && value < min) {
    addError(errors, fileLabel, `${key} must be at least ${min}`);
  }

  if (typeof max === 'number' && value > max) {
    addError(errors, fileLabel, `${key} must be at most ${max}`);
  }

  return value;
}

function validateAddress(errors, fileLabel, value, { allowZero = false, field }) {
  if (typeof value !== 'string') {
    addError(errors, fileLabel, `${field} must be a string address`);
    return;
  }

  if (!isAddress(value)) {
    addError(errors, fileLabel, `${field} must be a valid 0x-prefixed address`);
    return;
  }

  if (!allowZero && equalsIgnoreCase(value, ZERO_ADDRESS)) {
    addError(errors, fileLabel, `${field} must not be the zero address`);
  }
}

function validateAgiAlphaConfig(errors, fileLabel, data, { variant }) {
  if (!data || typeof data !== 'object') {
    addError(errors, fileLabel, 'configuration must be an object');
    return;
  }

  const token = data.token;
  if (variant === 'mainnet' || variant === 'sepolia') {
    validateAddress(errors, fileLabel, token, { field: 'token' });
    if (variant === 'mainnet' && typeof token === 'string' && !equalsIgnoreCase(token, AGI_MAINNET_TOKEN)) {
      addError(
        errors,
        fileLabel,
        `token must equal ${AGI_MAINNET_TOKEN} for mainnet deployments`
      );
    }
  } else if (typeof token === 'string' && token.toLowerCase() !== 'mock') {
    validateAddress(errors, fileLabel, token, { field: 'token', allowZero: false });
  }

  const decimals = ensureInteger(errors, fileLabel, data, 'decimals', { min: 0, max: 255 });
  if (decimals !== null && (variant === 'mainnet' || variant === 'sepolia') && decimals !== 18) {
    addError(errors, fileLabel, 'decimals must be 18 for the production token');
  }

  ensureString(errors, fileLabel, data, 'symbol', { required: true, nonEmpty: true });
  ensureString(errors, fileLabel, data, 'name', { required: true, nonEmpty: true });

  const burnAddress = data.burnAddress;
  validateAddress(errors, fileLabel, burnAddress, { field: 'burnAddress' });
  if (
    typeof burnAddress === 'string'
    && variant === 'mainnet'
    && !equalsIgnoreCase(burnAddress, AGI_MAINNET_BURN)
  ) {
    addError(errors, fileLabel, `burnAddress must equal ${AGI_MAINNET_BURN} on mainnet`);
  }
}

function validateEnsRoot(errors, fileLabel, data, rootKey, hashKey, { required }) {
  const root = data[rootKey];
  const hash = data[hashKey];

  if (root === null || root === undefined) {
    if (required) {
      addError(errors, fileLabel, `${rootKey} must be specified`);
    }
    if (hash !== null && hash !== undefined) {
      addError(errors, fileLabel, `${hashKey} must be null when ${rootKey} is not set`);
    }
    return;
  }

  if (typeof root !== 'string' || root.trim().length === 0) {
    addError(errors, fileLabel, `${rootKey} must be a non-empty string`);
    return;
  }

  if (hash === null || hash === undefined) {
    addError(errors, fileLabel, `${hashKey} must be set when ${rootKey} is provided`);
    return;
  }

  if (typeof hash !== 'string' || !HEX_32_REGEX.test(hash)) {
    addError(errors, fileLabel, `${hashKey} must be a 32-byte hex string`);
    return;
  }

  const expectedHash = namehash(root.trim());
  if (!equalsIgnoreCase(expectedHash, hash)) {
    addError(
      errors,
      fileLabel,
      `${hashKey} does not match namehash(${root.trim()}), expected ${expectedHash}`
    );
  }
}

function validateEnsConfig(errors, fileLabel, data, { variant }) {
  if (!data || typeof data !== 'object') {
    addError(errors, fileLabel, 'configuration must be an object');
    return;
  }

  const registry = data.registry;
  if (registry === null || registry === undefined) {
    addError(errors, fileLabel, 'registry must be specified');
  } else if (variant === 'mainnet') {
    validateAddress(errors, fileLabel, registry, { field: 'registry' });
    if (typeof registry === 'string' && !equalsIgnoreCase(registry, ENS_MAINNET_REGISTRY)) {
      addError(errors, fileLabel, `registry must equal ${ENS_MAINNET_REGISTRY} on mainnet`);
    }
  } else if (variant === 'sepolia') {
    validateAddress(errors, fileLabel, registry, { field: 'registry' });
  } else if (registry !== ZERO_ADDRESS) {
    validateAddress(errors, fileLabel, registry, { field: 'registry', allowZero: false });
  }

  const nameWrapper = data.nameWrapper;
  if (nameWrapper !== null && nameWrapper !== undefined) {
    if (typeof nameWrapper !== 'string') {
      addError(errors, fileLabel, 'nameWrapper must be a string when specified');
    } else if (variant === 'mainnet' || variant === 'sepolia') {
      validateAddress(errors, fileLabel, nameWrapper, { field: 'nameWrapper' });
      if (variant === 'mainnet' && !equalsIgnoreCase(nameWrapper, ENS_MAINNET_NAME_WRAPPER)) {
        addError(
          errors,
          fileLabel,
          `nameWrapper must equal ${ENS_MAINNET_NAME_WRAPPER} on mainnet`
        );
      }
    } else if (!equalsIgnoreCase(nameWrapper, ZERO_ADDRESS)) {
      validateAddress(errors, fileLabel, nameWrapper, { field: 'nameWrapper' });
    }
  }

  const requireRoots = variant === 'mainnet' || variant === 'sepolia';
  validateEnsRoot(errors, fileLabel, data, 'agentRoot', 'agentRootHash', {
    required: requireRoots,
  });
  validateEnsRoot(errors, fileLabel, data, 'clubRoot', 'clubRootHash', {
    required: requireRoots,
  });

  let alphaEnabled = false;
  if (data.alphaEnabled !== null && data.alphaEnabled !== undefined) {
    if (typeof data.alphaEnabled !== 'boolean') {
      addError(errors, fileLabel, 'alphaEnabled must be a boolean when specified');
    } else {
      alphaEnabled = data.alphaEnabled;
    }
  }

  validateEnsRoot(errors, fileLabel, data, 'alphaClubRoot', 'alphaClubRootHash', {
    required: alphaEnabled,
  });
}

function parseBigIntLike(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return null;
    }
    try {
      return BigInt(value);
    } catch (_) {
      return null;
    }
  }

  if (typeof value === 'string') {
    if (!/^\d+$/.test(value)) {
      return null;
    }
    try {
      return BigInt(value);
    } catch (_) {
      return null;
    }
  }

  return null;
}

function ensureDomainNode(errors, fileLabel, domain, ensKeys) {
  if (typeof domain !== 'object' || domain === null) {
    addError(errors, fileLabel, 'domain entries must be objects');
    return null;
  }

  if (typeof domain.node === 'string') {
    if (!HEX_32_REGEX.test(domain.node)) {
      addError(errors, fileLabel, `domain ${domain.name || '<unnamed>'} node must be a 32-byte hex string`);
      return null;
    }
    return domain.node;
  }

  if (typeof domain.rootKey === 'string') {
    if (!ensKeys.has(domain.rootKey)) {
      addError(
        errors,
        fileLabel,
        `domain ${domain.name || '<unnamed>'} rootKey must reference a valid ENS config key`
      );
    }
    return null;
  }

  addError(errors, fileLabel, `domain ${domain.name || '<unnamed>'} must specify node or rootKey`);
  return null;
}

function validateRegistrarConfig(errors, fileLabel, data, { variant, agiConfig } = {}) {
  if (!data || typeof data !== 'object') {
    addError(errors, fileLabel, 'configuration must be an object');
    return;
  }

  if (data.address !== null && data.address !== undefined) {
    validateAddress(errors, fileLabel, data.address, { field: 'address', allowZero: false });
  }

  const productionNetwork = variant === 'mainnet' || variant === 'sepolia';
  const agiToken =
    typeof agiConfig?.token === 'string' && agiConfig.token.toLowerCase() !== 'mock'
      ? agiConfig.token
      : null;

  const defaultToken = data.defaultToken;
  if (defaultToken !== null && defaultToken !== undefined) {
    validateAddress(errors, fileLabel, defaultToken, { field: 'defaultToken', allowZero: false });
  } else if (productionNetwork) {
    addError(errors, fileLabel, 'defaultToken must be provided for production networks');
  }

  if (
    agiToken &&
    typeof defaultToken === 'string' &&
    isAddress(defaultToken) &&
    !equalsIgnoreCase(defaultToken, agiToken)
  ) {
    addError(
      errors,
      fileLabel,
      `defaultToken must equal ${agiToken} to match agialpha.${variant}.json`
    );
  }

  const domains = data.domains;
  if (!Array.isArray(domains)) {
    addError(errors, fileLabel, 'domains must be an array');
    return;
  }

  const ensKeys = new Set(['agentRootHash', 'clubRootHash', 'alphaClubRootHash']);

  domains.forEach((domain) => {
    const domainName = typeof domain?.name === 'string' ? domain.name : '<unnamed>';
    ensureDomainNode(errors, fileLabel, domain, ensKeys);

    if (domain.expectedBeneficiary !== null && domain.expectedBeneficiary !== undefined) {
      validateAddress(errors, fileLabel, domain.expectedBeneficiary, {
        field: `${domainName}.expectedBeneficiary`,
        allowZero: false,
      });
    }

    if (domain.expectedToken !== null && domain.expectedToken !== undefined) {
      validateAddress(errors, fileLabel, domain.expectedToken, {
        field: `${domainName}.expectedToken`,
        allowZero: false,
      });
      if (agiToken && isAddress(domain.expectedToken) && !equalsIgnoreCase(domain.expectedToken, agiToken)) {
        addError(
          errors,
          fileLabel,
          `${domainName}.expectedToken must equal ${agiToken} to match agialpha.${variant}.json`
        );
      }
    }

    if (domain.defaultDuration !== null && domain.defaultDuration !== undefined) {
      const parsed = parseBigIntLike(domain.defaultDuration);
      if (parsed === null || parsed <= 0n) {
        addError(errors, fileLabel, `${domainName}.defaultDuration must be a positive integer`);
      }
    }

    const labels = domain.labels;
    if (labels !== undefined) {
      if (!Array.isArray(labels)) {
        addError(errors, fileLabel, `${domainName}.labels must be an array when provided`);
      } else {
        labels.forEach((entry) => {
          if (!entry || typeof entry !== 'object') {
            addError(errors, fileLabel, `${domainName}.labels entries must be objects`);
            return;
          }

          if (typeof entry.label !== 'string' || entry.label.trim().length === 0) {
            addError(errors, fileLabel, `${domainName}.labels entries must include a non-empty label`);
          }

          if (entry.expectedToken !== null && entry.expectedToken !== undefined) {
            validateAddress(errors, fileLabel, entry.expectedToken, {
              field: `${domainName}.labels.expectedToken`,
              allowZero: false,
            });
            if (
              agiToken &&
              isAddress(entry.expectedToken) &&
              !equalsIgnoreCase(entry.expectedToken, agiToken)
            ) {
              addError(
                errors,
                fileLabel,
                `${domainName}.labels.expectedToken must equal ${agiToken} to match agialpha.${variant}.json`
              );
            }
          }

          if (entry.minPrice !== null && entry.minPrice !== undefined) {
            const parsed = parseBigIntLike(entry.minPrice);
            if (parsed === null || parsed < 0n) {
              addError(errors, fileLabel, `${domainName}.labels.minPrice must be a non-negative integer`);
            }
          }

          if (entry.maxPrice !== null && entry.maxPrice !== undefined) {
            const parsed = parseBigIntLike(entry.maxPrice);
            if (parsed === null || parsed < 0n) {
              addError(errors, fileLabel, `${domainName}.labels.maxPrice must be a non-negative integer`);
            }
          }

          if (entry.duration !== null && entry.duration !== undefined) {
            const parsed = parseBigIntLike(entry.duration);
            if (parsed === null || parsed <= 0n) {
              addError(errors, fileLabel, `${domainName}.labels.duration must be a positive integer`);
            }
          }
        });
      }
    }
  });
}

function validateParamsConfig(errors, fileLabel, data) {
  if (!data || typeof data !== 'object') {
    addError(errors, fileLabel, 'configuration must be an object');
    return;
  }

  ensureInteger(errors, fileLabel, data, 'commitWindow', { positive: true });
  ensureInteger(errors, fileLabel, data, 'revealWindow', { positive: true });
  ensureInteger(errors, fileLabel, data, 'disputeWindow', { positive: true });

  const approval = ensureInteger(errors, fileLabel, data, 'approvalThresholdBps', {
    min: 0,
    max: 10_000,
  });
  const fee = ensureInteger(errors, fileLabel, data, 'feeBps', { min: 0, max: 10_000 });
  const slash = ensureInteger(errors, fileLabel, data, 'slashBpsMax', { min: 0, max: 10_000 });
  const quorumMin = ensureInteger(errors, fileLabel, data, 'quorumMin', { min: 1 });
  const quorumMax = ensureInteger(errors, fileLabel, data, 'quorumMax', { min: 1 });

  if (quorumMin !== null && quorumMax !== null && quorumMax < quorumMin) {
    addError(errors, fileLabel, 'quorumMax must be greater than or equal to quorumMin');
  }

  if (approval !== null && slash !== null && approval > slash) {
    // approval threshold does not need to be less than slash, but catch extreme misconfiguration
    if (slash < 100) {
      addError(errors, fileLabel, 'slashBpsMax is unexpectedly lower than approvalThresholdBps');
    }
  }

  if (fee !== null && slash !== null && fee > slash) {
    addError(errors, fileLabel, 'slashBpsMax must be at least as large as feeBps');
  }
}

function validateAllConfigs({ baseDir } = {}) {
  const configDir = baseDir || path.join(__dirname, '..', 'config');
  const errors = [];

  const variants = [
    { name: 'dev', files: { agialpha: 'agialpha.dev.json', ens: 'ens.dev.json', registrar: 'registrar.dev.json' } },
    {
      name: 'mainnet',
      files: { agialpha: 'agialpha.mainnet.json', ens: 'ens.mainnet.json', registrar: 'registrar.mainnet.json' },
    },
    {
      name: 'sepolia',
      files: { agialpha: 'agialpha.sepolia.json', ens: 'ens.sepolia.json', registrar: 'registrar.sepolia.json' },
    },
  ];

  const agiConfigs = {};

  const readAndValidate = (fileName, validator) => {
    const filePath = path.join(configDir, fileName);
    try {
      const data = readJson(filePath);
      validator(data);
      return data;
    } catch (error) {
      addError(errors, fileName, error.message);
      return null;
    }
  };

  variants.forEach(({ name, files }) => {
    const agiConfig = readAndValidate(files.agialpha, (data) =>
      validateAgiAlphaConfig(errors, files.agialpha, data, { variant: name })
    );
    if (agiConfig) {
      agiConfigs[name] = agiConfig;
    }
  });

  variants.forEach(({ name, files }) => {
    readAndValidate(files.ens, (data) =>
      validateEnsConfig(errors, files.ens, data, { variant: name })
    );
  });

  variants.forEach(({ name, files }) => {
    readAndValidate(files.registrar, (data) =>
      validateRegistrarConfig(errors, files.registrar, data, { variant: name, agiConfig: agiConfigs[name] })
    );
  });

  readAndValidate('params.json', (data) => validateParamsConfig(errors, 'params.json', data));

  return { errors };
}

function main() {
  const { errors } = validateAllConfigs();
  if (errors.length > 0) {
    console.error('Configuration validation failed:');
    for (const message of errors) {
      console.error(` - ${message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('All configuration files passed validation.');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

module.exports = {
  validateAllConfigs,
  _internal: {
    readJson,
    validateAgiAlphaConfig,
    validateEnsConfig,
    validateRegistrarConfig,
    validateParamsConfig,
    validateEnsRoot,
    ensureInteger,
    validateAddress,
    ensureString,
  },
};
