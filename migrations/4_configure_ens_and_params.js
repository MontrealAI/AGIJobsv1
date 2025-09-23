const IdentityRegistry = artifacts.require('IdentityRegistry');
const { readConfig } = require('../scripts/config-loader');

module.exports = async function (_deployer, network, _accounts) {
  const ensCfg = readConfig('ens', network);
  const identity = await IdentityRegistry.deployed();
  if (ensCfg.agentRootHash && ensCfg.clubRootHash) {
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
    const ZERO_NAMEHASH = '0x0000000000000000000000000000000000000000000000000000000000000000';
    const wrapperAddress = ensCfg.nameWrapper || ZERO_ADDRESS;
    const alphaHash = ensCfg.alphaClubRootHash || ZERO_NAMEHASH;

    await identity.configureEns(
      ensCfg.registry,
      wrapperAddress,
      ensCfg.agentRootHash,
      ensCfg.clubRootHash,
      alphaHash,
      Boolean(ensCfg.alphaEnabled)
    );
  }
};
