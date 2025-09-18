const IdentityRegistry = artifacts.require('IdentityRegistry');
const ensCfg = require('../config/ens.json');

module.exports = async function (_deployer, _network, _accounts) {
  const identity = await IdentityRegistry.deployed();
  if (ensCfg.agentRootHash && ensCfg.clubRootHash) {
    await identity.configureMainnet(ensCfg.registry, ensCfg.agentRootHash, ensCfg.clubRootHash);
  }
};
