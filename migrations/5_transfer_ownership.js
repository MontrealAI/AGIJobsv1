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
  const isTest = process.env.TRUFFLE_TEST === 'true';
  let govSafe = process.env.GOV_SAFE;
  if (!govSafe) {
    if (isTest && accounts && accounts.length > 0) {
      govSafe = accounts[0];
    } else {
      throw new Error('GOV_SAFE environment variable must be set to the governance Safe address');
    }
  }
  if (!web3.utils.isAddress(govSafe)) {
    throw new Error('GOV_SAFE must be a valid Ethereum address');
  }

  const timelock = process.env.TIMELOCK_ADDR;
  if (timelock && !web3.utils.isAddress(timelock)) {
    throw new Error('TIMELOCK_ADDR must be a valid Ethereum address when provided');
  }

  const targetOwner = web3.utils.toChecksumAddress(govSafe);
  const timelockAddr = timelock ? web3.utils.toChecksumAddress(timelock) : null;

  const jr = await JobRegistry.deployed();
  for (const Module of OWNABLE_MODULES) {
    const instance = await Module.deployed();
    if (typeof instance.transferOwnership === 'function') {
      await instance.transferOwnership(targetOwner);
    }
    if (timelockAddr && typeof instance.setTimelockAdmin === 'function') {
      await instance.setTimelockAdmin(timelockAddr);
    }
  }

  if (timelockAddr && typeof jr.setTimelockAdmin === 'function') {
    await jr.setTimelockAdmin(timelockAddr);
  }
  if (typeof jr.transferOwnership === 'function') {
    await jr.transferOwnership(targetOwner);
  }
};
