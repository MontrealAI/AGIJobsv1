const fs = require('fs');
const path = require('path');

const DEFAULT_VARIANT = 'mainnet';

const VARIANT_ALIASES = new Map(
  Object.entries({
    mainnet: 'mainnet',
    sepolia: 'sepolia',
    dev: 'dev',
    development: 'dev',
    localhost: 'dev',
    hardhat: 'dev',
    test: 'dev',
    coverage: 'dev',
  })
);

const SUPPORTED_VARIANTS = ['mainnet', 'sepolia', 'dev'];

function resolveVariant(networkOrVariant = DEFAULT_VARIANT) {
  if (!networkOrVariant) {
    return DEFAULT_VARIANT;
  }

  const normalized = networkOrVariant.toLowerCase();

  const resolved = VARIANT_ALIASES.get(normalized);
  if (resolved) {
    return resolved;
  }

  throw new Error(
    `Unsupported network variant "${networkOrVariant}". Expected one of: ${SUPPORTED_VARIANTS.join(
      ', '
    )}`
  );
}

function configPath(configName, networkOrVariant) {
  const variant = resolveVariant(networkOrVariant);
  return path.join(__dirname, '..', 'config', `${configName}.${variant}.json`);
}

function readConfig(configName, networkOrVariant) {
  const filePath = configPath(configName, networkOrVariant);
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

module.exports = {
  configPath,
  readConfig,
  resolveVariant,
  SUPPORTED_VARIANTS,
};
