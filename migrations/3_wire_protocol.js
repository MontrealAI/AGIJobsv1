const IdentityRegistry = artifacts.require('IdentityRegistry');
const StakeManager = artifacts.require('StakeManager');
const FeePool = artifacts.require('FeePool');
const ValidationModule = artifacts.require('ValidationModule');
const DisputeModule = artifacts.require('DisputeModule');
const ReputationEngine = artifacts.require('ReputationEngine');
const JobRegistry = artifacts.require('JobRegistry');

const params = require('../config/params.json');

module.exports = async function (_deployer, network, accounts) {
  const jr = await JobRegistry.deployed();
  const identity = await IdentityRegistry.deployed();
  const staking = await StakeManager.deployed();
  const validation = await ValidationModule.deployed();
  const dispute = await DisputeModule.deployed();
  const reputation = await ReputationEngine.deployed();
  const feePool = await FeePool.deployed();

  await jr.setModules({
    identity: identity.address,
    staking: staking.address,
    validation: validation.address,
    dispute: dispute.address,
    reputation: reputation.address,
    feePool: feePool.address
  });

  await staking.setJobRegistry(jr.address);
  await feePool.setJobRegistry(jr.address);
  await dispute.setJobRegistry(jr.address);
  await reputation.setJobRegistry(jr.address);

  await jr.setTimings(params.commitWindow, params.revealWindow, params.disputeWindow);
  await jr.setThresholds(
    params.approvalThresholdBps,
    params.quorumMin,
    params.quorumMax,
    params.feeBps,
    params.slashBpsMax
  );
};
