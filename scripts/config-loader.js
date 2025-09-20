const fs = require('fs');
const path = require('path');

const DEFAULT_VARIANT = 'mainnet';

function resolveVariant(networkOrVariant = DEFAULT_VARIANT) {
  if (!networkOrVariant) {
    return DEFAULT_VARIANT;
  }

  const normalized = networkOrVariant.toLowerCase();

  if (normalized === 'mainnet') {
    return 'mainnet';
  }

  const devVariants = new Set([
    'dev',
    'development',
    'localhost',
    'hardhat',
    'sepolia'
  ]);

  if (devVariants.has(normalized)) {
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
