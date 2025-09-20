const IdentityRegistry = artifacts.require('IdentityRegistry');
const { readConfig } = require('../scripts/config-loader');

module.exports = async function (_deployer, network, _accounts) {
  const ensCfg = readConfig('ens', network);
  const identity = await IdentityRegistry.deployed();
  if (ensCfg.agentRootHash && ensCfg.clubRootHash) {
    await identity.configureMainnet(ensCfg.registry, ensCfg.agentRootHash, ensCfg.clubRootHash);
  }
};
