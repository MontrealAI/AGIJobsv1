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

    expectEq(modules.identity, (await IdentityRegistry.deployed()).address, 'identity');
    expectEq(modules.staking, (await StakeManager.deployed()).address, 'staking');
    expectEq(modules.validation, (await ValidationModule.deployed()).address, 'validation');
    expectEq(modules.dispute, (await DisputeModule.deployed()).address, 'dispute');
    expectEq(modules.reputation, (await ReputationEngine.deployed()).address, 'reputation');
    expectEq(modules.feePool, (await FeePool.deployed()).address, 'feePool');

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
