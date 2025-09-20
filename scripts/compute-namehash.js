const fs = require('fs');
const path = require('path');
const { hash: computeHash } = require('eth-ens-namehash');

const { configPath, readConfig, resolveVariant } = require('./config-loader');

function parseArguments(argv) {
  const args = argv.slice(2);
  let network;
  let explicitPath;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--network') {
      if (i + 1 < args.length) {
        network = args[i + 1];
        i += 1;
      }
      continue;
    }

    if (arg.startsWith('--')) {
      continue;
    }

    if (!explicitPath && (arg.includes('/') || arg.includes('\\') || arg.endsWith('.json'))) {
      explicitPath = arg;
      continue;
    }

    if (!network) {
      network = arg;
    }
  }

  return { network, explicitPath };
}

const { network, explicitPath } = parseArguments(process.argv);

let targetPath;
let config;

if (explicitPath) {
  targetPath = path.resolve(process.cwd(), explicitPath);
  const raw = fs.readFileSync(targetPath, 'utf8');
  config = JSON.parse(raw);
} else {
  const variant = resolveVariant(network);
  targetPath = configPath('ens', variant);
  config = readConfig('ens', variant);
}

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
console.log(`Updated ENS namehashes in ${targetPath}`);
