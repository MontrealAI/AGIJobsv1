const JobRegistry = artifacts.require('JobRegistry');
const StakeManager = artifacts.require('StakeManager');
const FeePool = artifacts.require('FeePool');
const ValidationModule = artifacts.require('ValidationModule');
const DisputeModule = artifacts.require('DisputeModule');
const ReputationEngine = artifacts.require('ReputationEngine');
const IdentityRegistry = artifacts.require('IdentityRegistry');
const CertificateNFT = artifacts.require('CertificateNFT');

const OWNABLE_MODULES = [
  StakeManager,
  FeePool,
  ValidationModule,
  DisputeModule,
  ReputationEngine,
  IdentityRegistry,
  CertificateNFT
];

module.exports = async function (_deployer, _network, accounts) {
  const targetOwner = process.env.GOV_SAFE || accounts[0];
  const jr = await JobRegistry.deployed();
  for (const Module of OWNABLE_MODULES) {
    const instance = await Module.deployed();
    if (instance.transferOwnership) {
      await instance.transferOwnership(targetOwner);
    }
  }
  if (jr.transferOwnership) {
    await jr.transferOwnership(targetOwner);
  }
};
