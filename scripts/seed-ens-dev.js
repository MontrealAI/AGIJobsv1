const fs = require('fs');

const MockENSRegistry = artifacts.require('MockENSRegistry');

const { hash: namehash } = require('eth-ens-namehash');
const { configPath, readConfig, resolveVariant } = require('./config-loader');

function extractNetwork(argv) {
  const networkFlagIndex = argv.findIndex((arg) => arg === '--network');
  if (networkFlagIndex !== -1 && argv[networkFlagIndex + 1]) {
    return argv[networkFlagIndex + 1];
  }

  return undefined;
}

const labelhash = (label) => {
  return web3.utils.keccak256(web3.utils.utf8ToHex(label));
};

module.exports = async function (callback) {
  try {
    const networkName = extractNetwork(process.argv) || process.env.TRUFFLE_NETWORK;
    const variant = resolveVariant(networkName);

    if (variant !== 'dev') {
      console.log('Skipping ENS seeding for non-development network');
      callback();
      return;
    }

    const registry = await MockENSRegistry.deployed();
    const accounts = await web3.eth.getAccounts();
    const owner = accounts[0];

    const rootNode = namehash('');
    const ethNode = namehash('eth');
    const agiNode = namehash('agi.eth');
    const agentNode = namehash('agent.agi.eth');
    const clubNode = namehash('club.agi.eth');

    const setSubnodeOwner = async (parentNode, label) => {
      await registry.setSubnodeOwner(parentNode, labelhash(label), owner, { from: owner });
    };

    await setSubnodeOwner(rootNode, 'eth');
    await setSubnodeOwner(ethNode, 'agi');
    await setSubnodeOwner(agiNode, 'agent');
    await setSubnodeOwner(agiNode, 'club');
    await setSubnodeOwner(agentNode, 'alice');
    await setSubnodeOwner(clubNode, 'validator');

    const ensConfigPath = configPath('ens', variant);
    const ensConfig = readConfig('ens', variant);

    ensConfig.agentRoot = 'agent.agi.eth';
    ensConfig.clubRoot = 'club.agi.eth';
    ensConfig.agentRootHash = namehash('agent.agi.eth');
    ensConfig.clubRootHash = namehash('club.agi.eth');

    fs.writeFileSync(ensConfigPath, `${JSON.stringify(ensConfig, null, 2)}\n`);

    console.log('Seeded MockENSRegistry with local ENS records');
    callback();
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
    callback(err);
  }
};
