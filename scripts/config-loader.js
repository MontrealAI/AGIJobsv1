const fs = require('fs');
const path = require('path');

const DEFAULT_VARIANT = 'mainnet';

function resolveVariant(networkOrVariant = DEFAULT_VARIANT) {
  if (!networkOrVariant) {
    return DEFAULT_VARIANT;
  }
  if (networkOrVariant === 'development' || networkOrVariant === 'dev') {
    return 'dev';
  }
  if (networkOrVariant === 'mainnet') {
    return 'mainnet';
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
