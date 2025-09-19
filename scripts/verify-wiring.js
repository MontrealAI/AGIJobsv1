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
    const jobRegistry = await JobRegistry.deployed();
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
    const modules = await jobRegistry.modules();
    const expectEq = (lhs, rhs, label) => {
      const left = lhs.toLowerCase();
      if (left === ZERO_ADDRESS) {
        throw new Error(`Zero address for ${label}`);
      }
      if (left !== rhs.toLowerCase()) {
        throw new Error(`Mismatch for ${label}: ${lhs} !== ${rhs}`);
      }
    };

    const owner = await jobRegistry.owner();
    expectEq(owner, owner, 'jobRegistry.owner');

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

    await Promise.all(
      [
        ['identity.owner', identity.owner()],
        ['staking.owner', staking.owner()],
        ['validation.owner', validation.owner()],
        ['dispute.owner', dispute.owner()],
        ['reputation.owner', reputation.owner()],
        ['feePool.owner', feePool.owner()],
      ].map(async ([label, valuePromise]) => {
        const value = await valuePromise;
        expectEq(value, owner, label);
      })
    );

    expectEq(await staking.jobRegistry(), jobRegistry.address, 'staking.jobRegistry');
    expectEq(await feePool.jobRegistry(), jobRegistry.address, 'feePool.jobRegistry');
    expectEq(await dispute.jobRegistry(), jobRegistry.address, 'dispute.jobRegistry');
    expectEq(await reputation.jobRegistry(), jobRegistry.address, 'reputation.jobRegistry');

    const thresholds = await jobRegistry.thresholds();
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
