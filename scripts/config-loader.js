const fs = require('fs');
const path = require('path');

const DEFAULT_VARIANT = 'mainnet';

const DEV_VARIANTS = new Set(['dev', 'development', 'localhost', 'hardhat']);

function resolveVariant(networkOrVariant = DEFAULT_VARIANT) {
  if (!networkOrVariant) {
    return DEFAULT_VARIANT;
  }

  const normalized = networkOrVariant.toLowerCase();

  if (normalized === 'mainnet') {
    return 'mainnet';
  }

  if (normalized === 'sepolia') {
    return 'sepolia';
  }

  if (DEV_VARIANTS.has(normalized)) {
    return 'dev';
  }

  return DEFAULT_VARIANT;
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
  resolveVariant
};
