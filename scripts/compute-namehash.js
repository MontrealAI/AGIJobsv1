const fs = require('fs');
const { hash: computeHash } = require('eth-ens-namehash');

const { configPath, readConfig, resolveVariant } = require('./config-loader');

const variant = resolveVariant(process.argv[2]);
const targetPath = configPath('ens', variant);
const config = readConfig('ens', variant);

if (config.agentRoot) {
  config.agentRootHash = computeHash(config.agentRoot);
}
if (config.clubRoot) {
  config.clubRootHash = computeHash(config.clubRoot);
}

fs.writeFileSync(targetPath, JSON.stringify(config, null, 2));
console.log(`Updated ENS namehashes for ${variant}`);
