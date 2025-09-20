const JobRegistry = artifacts.require('JobRegistry');
const IdentityRegistry = artifacts.require('IdentityRegistry');
const StakeManager = artifacts.require('StakeManager');
const ValidationModule = artifacts.require('ValidationModule');
const DisputeModule = artifacts.require('DisputeModule');
const ReputationEngine = artifacts.require('ReputationEngine');
const FeePool = artifacts.require('FeePool');
const CertificateNFT = artifacts.require('CertificateNFT');

const params = require('../config/params.json');

module.exports = async function (callback) {
  try {
    const { GOV_SAFE, TIMELOCK_ADDR } = process.env;
    const expectedOwner = GOV_SAFE || TIMELOCK_ADDR;

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

    const ensureOwner = (value, label, expected) => {
      const normalizedValue = value.toLowerCase();
      if (normalizedValue === ZERO_ADDRESS) {
        throw new Error(`Zero address for ${label}`);
      }
      if (expected && normalizedValue !== expected.toLowerCase()) {
        throw new Error(
          `Ownership mismatch for ${label}: expected ${expected} but found ${value}`
        );
      }
    };

    if (expectedOwner) {
      console.log(`Checking ownership against ${expectedOwner}`);
    }

    const owner = await jobRegistry.owner();
    const ownerCheckTarget = expectedOwner || owner;
    ensureOwner(owner, 'jobRegistry.owner', ownerCheckTarget);

    const identity = await IdentityRegistry.deployed();
    const staking = await StakeManager.deployed();
    const validation = await ValidationModule.deployed();
    const dispute = await DisputeModule.deployed();
    const reputation = await ReputationEngine.deployed();
    const feePool = await FeePool.deployed();
    const certificate = await CertificateNFT.deployed();

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
        ['certificate.owner', certificate.owner()],
      ].map(async ([label, valuePromise]) => {
        const value = await valuePromise;
        ensureOwner(value, label, ownerCheckTarget);
      })
    );

    expectEq(await staking.jobRegistry(), jobRegistry.address, 'staking.jobRegistry');
    expectEq(
      await staking.feeRecipient(),
      feePool.address,
      'staking.feeRecipient'
    );
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

    const timings = await jobRegistry.timings();
    if (Number(timings.commitWindow) !== params.commitWindow) {
      throw new Error('commitWindow mismatch');
    }
    if (Number(timings.revealWindow) !== params.revealWindow) {
      throw new Error('revealWindow mismatch');
    }
    if (Number(timings.disputeWindow) !== params.disputeWindow) {
      throw new Error('disputeWindow mismatch');
    }

    console.log('WIRING OK');
    callback();
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
    callback(err);
  }
};
