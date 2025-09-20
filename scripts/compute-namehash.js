const fs = require('fs');
const { hash: computeHash } = require('eth-ens-namehash');

const { configPath, readConfig, resolveVariant } = require('./config-loader');

function extractNetwork(argv) {
  const networkFlagIndex = argv.findIndex((arg) => arg === '--network');
  if (networkFlagIndex !== -1 && argv[networkFlagIndex + 1]) {
    return argv[networkFlagIndex + 1];
  }

  const positional = argv[2];
  if (positional && !positional.startsWith('--')) {
    return positional;
  }

  return undefined;
}

const variant = resolveVariant(extractNetwork(process.argv));
const targetPath = configPath('ens', variant);
const config = readConfig('ens', variant);

const assignHash = (rootKey, hashKey) => {
  const value = config[rootKey];
  if (typeof value === 'string' && value.trim().length > 0) {
    config[hashKey] = computeHash(value);
  } else {
    config[hashKey] = null;
  }
};

assignHash('agentRoot', 'agentRootHash');
assignHash('clubRoot', 'clubRootHash');

fs.writeFileSync(targetPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Updated ENS namehashes for ${variant}`);
