const IdentityRegistry = artifacts.require('IdentityRegistry');
const { readConfig } = require('../scripts/config-loader');

module.exports = async function (_deployer, network, _accounts) {
  const ensCfg = readConfig('ens', network);
  const identity = await IdentityRegistry.deployed();
  if (ensCfg.agentRootHash && ensCfg.clubRootHash) {
    await identity.configureEns(
      ensCfg.registry,
      ensCfg.nameWrapper,
      ensCfg.agentRootHash,
      ensCfg.clubRootHash,
      ensCfg.alphaClubRootHash || '0x'.padEnd(66, '0'),
      Boolean(ensCfg.alphaEnabled)
    );
  }
};
