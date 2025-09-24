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
    let variant;
    try {
      variant = resolveVariant(networkName);
    } catch (error) {
      console.error(error.message || error);
      process.exitCode = 1;
      callback(error);
      return;
    }

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
    const alphaAgentNode = namehash('alpha.agent.agi.eth');
    const alphaClubNode = namehash('alpha.club.agi.eth');

    const setSubnodeOwner = async (parentNode, label, newOwner = owner, domainName = label) => {
      await registry.setSubnodeOwner(parentNode, labelhash(label), newOwner, { from: owner });
      console.log(`Assigned ${domainName} to ${newOwner}`);
    };

    await setSubnodeOwner(rootNode, 'eth', owner, 'eth');
    await setSubnodeOwner(ethNode, 'agi', owner, 'agi.eth');
    await setSubnodeOwner(agiNode, 'agent', owner, 'agent.agi.eth');
    await setSubnodeOwner(agiNode, 'club', owner, 'club.agi.eth');
    await setSubnodeOwner(agentNode, 'alpha', owner, 'alpha.agent.agi.eth');
    await setSubnodeOwner(clubNode, 'alpha', owner, 'alpha.club.agi.eth');
    await setSubnodeOwner(agentNode, 'alice', accounts[1], 'alice.agent.agi.eth');
    await setSubnodeOwner(alphaAgentNode, 'alice', accounts[1], 'alice.alpha.agent.agi.eth');
    await setSubnodeOwner(clubNode, 'validator', accounts[2], 'validator.club.agi.eth');
    await setSubnodeOwner(alphaClubNode, 'vip', accounts[2], 'vip.alpha.club.agi.eth');

    const ensConfigPath = configPath('ens', variant);
    const ensConfig = readConfig('ens', variant);

    ensConfig.agentRoot = 'agent.agi.eth';
    ensConfig.clubRoot = 'club.agi.eth';
    ensConfig.agentRootHash = namehash('agent.agi.eth');
    ensConfig.clubRootHash = namehash('club.agi.eth');
    ensConfig.alphaAgentRoot = 'alpha.agent.agi.eth';
    ensConfig.alphaAgentRootHash = alphaAgentNode;
    ensConfig.alphaAgentEnabled = true;
    ensConfig.alphaClubRoot = 'alpha.club.agi.eth';
    ensConfig.alphaClubRootHash = alphaClubNode;
    ensConfig.alphaEnabled = true;

    fs.writeFileSync(ensConfigPath, `${JSON.stringify(ensConfig, null, 2)}\n`);

    console.log('Seeded MockENSRegistry with local ENS records');
    callback();
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
    callback(err);
  }
};
