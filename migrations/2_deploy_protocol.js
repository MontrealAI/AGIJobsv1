const IdentityRegistry = artifacts.require('IdentityRegistry');
const StakeManager = artifacts.require('StakeManager');
const FeePool = artifacts.require('FeePool');
const ValidationModule = artifacts.require('ValidationModule');
const DisputeModule = artifacts.require('DisputeModule');
const ReputationEngine = artifacts.require('ReputationEngine');
const CertificateNFT = artifacts.require('CertificateNFT');
const JobRegistry = artifacts.require('JobRegistry');

const agiCfg = require('../config/agialpha.json');

module.exports = async function (deployer) {
  await deployer.deploy(IdentityRegistry);
  await deployer.deploy(StakeManager, agiCfg.token, agiCfg.decimals);
  await deployer.deploy(FeePool, agiCfg.token, agiCfg.burnAddress);
  await deployer.deploy(ValidationModule);
  await deployer.deploy(DisputeModule);
  await deployer.deploy(ReputationEngine);
  await deployer.deploy(CertificateNFT);
  await deployer.deploy(JobRegistry);
};
