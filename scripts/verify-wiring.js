const JobRegistry = artifacts.require('JobRegistry');
const IdentityRegistry = artifacts.require('IdentityRegistry');
const StakeManager = artifacts.require('StakeManager');
const ValidationModule = artifacts.require('ValidationModule');
const DisputeModule = artifacts.require('DisputeModule');
const ReputationEngine = artifacts.require('ReputationEngine');
const FeePool = artifacts.require('FeePool');

const params = require('../config/params.json');

module.exports = async function (callback) {
  try {
    const jr = await JobRegistry.deployed();
    const modules = await jr.modules();
    const expectEq = (lhs, rhs, label) => {
      if (lhs.toLowerCase() !== rhs.toLowerCase()) {
        throw new Error(`Mismatch for ${label}: ${lhs} !== ${rhs}`);
      }
    };

    const identity = await IdentityRegistry.deployed();
    const staking = await StakeManager.deployed();
    const validation = await ValidationModule.deployed();
    const dispute = await DisputeModule.deployed();
    const reputation = await ReputationEngine.deployed();
    const feePool = await FeePool.deployed();

    expectEq(modules.identity, identity.address, 'identity');
    expectEq(modules.staking, staking.address, 'staking');
    expectEq(modules.validation, validation.address, 'validation');
    expectEq(modules.dispute, dispute.address, 'dispute');
    expectEq(modules.reputation, reputation.address, 'reputation');
    expectEq(modules.feePool, feePool.address, 'feePool');

    expectEq(await staking.jobRegistry(), jr.address, 'staking.jobRegistry');
    expectEq(await staking.feePool(), feePool.address, 'staking.feePool');
    expectEq(await feePool.jobRegistry(), jr.address, 'feePool.jobRegistry');
    expectEq(await feePool.staking(), staking.address, 'feePool.staking');
    expectEq(await dispute.jobRegistry(), jr.address, 'dispute.jobRegistry');
    expectEq(await reputation.jobRegistry(), jr.address, 'reputation.jobRegistry');

    const thresholds = await jr.thresholds();
    if (Number(thresholds.feeBps) !== params.feeBps) {
      throw new Error('feeBps mismatch');
    }
    if (Number(thresholds.slashBpsMax) !== params.slashBpsMax) {
      throw new Error('slashBpsMax mismatch');
    }

    console.log('Wiring check passed');
    callback();
  } catch (err) {
    callback(err);
  }
};
