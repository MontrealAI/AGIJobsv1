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
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
    const modules = await jr.modules();
    const expectEq = (lhs, rhs, label) => {
      const left = lhs.toLowerCase();
      if (left === ZERO_ADDRESS) {
        throw new Error(`Zero address for ${label}`);
      }
      if (left !== rhs.toLowerCase()) {
        throw new Error(`Mismatch for ${label}: ${lhs} !== ${rhs}`);
      }
    };

    const identity = await IdentityRegistry.deployed();
    const staking = await StakeManager.deployed();
    const validation = await ValidationModule.deployed();
    const dispute = await DisputeModule.deployed();
    const reputation = await ReputationEngine.deployed();
    const feePool = await FeePool.deployed();

    [
      ['identity', modules.identity, identity.address],
      ['staking', modules.staking, staking.address],
      ['validation', modules.validation, validation.address],
      ['dispute', modules.dispute, dispute.address],
      ['reputation', modules.reputation, reputation.address],
      ['feePool', modules.feePool, feePool.address],
    ].forEach(([label, actual, expected]) => {
      expectEq(actual, expected, label);
    });

    expectEq(await staking.jobRegistry(), jr.address, 'staking.jobRegistry');
    expectEq(await feePool.jobRegistry(), jr.address, 'feePool.jobRegistry');
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
