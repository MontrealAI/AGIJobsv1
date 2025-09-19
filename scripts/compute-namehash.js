const fs = require('fs');
const path = require('path');
const { hash: computeHash } = require('eth-ens-namehash');

const configPath = path.join(__dirname, '..', 'config', 'ens.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

if (config.agentRoot) {
  config.agentRootHash = computeHash(config.agentRoot);
}
if (config.clubRoot) {
  config.clubRootHash = computeHash(config.clubRoot);
}

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('Updated ENS namehashes');
