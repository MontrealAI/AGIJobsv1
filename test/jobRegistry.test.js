const { expectRevert, time, expectEvent, constants } = require('@openzeppelin/test-helpers');
const IdentityRegistry = artifacts.require('IdentityRegistry');
const StakeManager = artifacts.require('StakeManager');
const FeePool = artifacts.require('FeePool');
const ValidationModule = artifacts.require('ValidationModule');
const DisputeModule = artifacts.require('DisputeModule');
const ReputationEngine = artifacts.require('ReputationEngine');
const CertificateNFT = artifacts.require('CertificateNFT');
const JobRegistry = artifacts.require('JobRegistry');

const CUSTOM_ERROR_TYPES = {
  NotConfigured: ['bytes32'],
};

function stripQuotes(value) {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function splitArgs(argsRaw) {
  if (!argsRaw) {
    return [];
  }

  const args = [];
  let current = '';
  let quote = null;
  for (const ch of argsRaw) {
    if (quote) {
      current += ch;
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === ',') {
      if (current.trim().length > 0) {
        args.push(current.trim());
      } else {
        args.push('');
      }
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim().length > 0) {
    args.push(current.trim());
  } else if (current.length > 0) {
    args.push('');
  }

  return args;
}

function parseCustomErrorSignature(signature) {
  const trimmed = signature.trim();
  const parts = trimmed.split('.');
  const last = parts[parts.length - 1];
  const match = last.match(/^([^(]+)\((.*)\)$/);
  if (!match) {
    return { errorName: last, args: [] };
  }

  const [, errorName, argsRaw] = match;
  return { errorName, args: splitArgs(argsRaw) };
}

function extractRevertData(error) {
  if (!error) {
    return null;
  }

  const { data } = error;
  if (!data) {
    return null;
  }

  if (typeof data === 'string') {
    return data;
  }

  if (typeof data.result === 'string') {
    return data.result;
  }

  if (typeof data.data === 'string') {
    return data.data;
  }

  for (const value of Object.values(data)) {
    if (!value) {
      continue;
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value.result === 'string') {
      return value.result;
    }
    if (typeof value.return === 'string') {
      return value.return;
    }
    if (typeof value.data === 'string') {
      return value.data;
    }
  }

  return null;
}

function matchesDecodedValue(expectedToken, type, actualValue) {
  if (!expectedToken || expectedToken.length === 0) {
    return true;
  }

  const normalizedToken = stripQuotes(expectedToken);

  if (type === 'bytes32') {
    if (normalizedToken.startsWith('0x')) {
      return actualValue.toLowerCase() === normalizedToken.toLowerCase();
    }

    const expectedHex = web3.utils
      .padRight(web3.utils.asciiToHex(normalizedToken), 66)
      .toLowerCase();
    if (actualValue.toLowerCase() === expectedHex) {
      return true;
    }

    try {
      const decodedAscii = web3.utils.hexToUtf8(actualValue).replace(/\u0000+$/g, '');
      if (decodedAscii === normalizedToken) {
        return true;
      }
    } catch (decodeError) {
      // Ignore decoding failures and fall through to false.
    }

    return false;
  }

  if (type.startsWith('uint')) {
    return web3.utils.toBN(actualValue).eq(web3.utils.toBN(normalizedToken));
  }

  if (type === 'address') {
    return (
      web3.utils.toChecksumAddress(actualValue) === web3.utils.toChecksumAddress(normalizedToken)
    );
  }

  if (type === 'string') {
    return actualValue === normalizedToken;
  }

  return true;
}

function tryDecodeCustomError(error, errorName, expectedArgs) {
  if (!errorName || !CUSTOM_ERROR_TYPES[errorName]) {
    return false;
  }

  const revertData = extractRevertData(error);
  if (!revertData || typeof revertData !== 'string') {
    return false;
  }

  const normalizedData = revertData.startsWith('0x') ? revertData.slice(2) : revertData;
  if (normalizedData.length < 8) {
    return false;
  }

  const actualSelector = normalizedData.slice(0, 8).toLowerCase();
  const types = CUSTOM_ERROR_TYPES[errorName];
  const expectedSelector = web3.eth.abi
    .encodeFunctionSignature(`${errorName}(${types.join(',')})`)
    .slice(2, 10)
    .toLowerCase();

  if (actualSelector !== expectedSelector) {
    return false;
  }

  if (types.length === 0) {
    return true;
  }

  const paramsData = '0x' + normalizedData.slice(8);
  const decoded = web3.eth.abi.decodeParameters(types, paramsData);

  for (let i = 0; i < Math.min(expectedArgs.length, types.length); i += 1) {
    if (!matchesDecodedValue(expectedArgs[i], types[i], decoded[i])) {
      return false;
    }
  }

  return true;
}

async function expectCustomError(promise, signature) {
  const { errorName, args } = parseCustomErrorSignature(signature);

  try {
    await promise;
    assert.fail(`Expected custom error ${signature} but call succeeded`);
  } catch (error) {
    const message = error.message || '';
    if (message.includes(signature)) {
      return;
    }

    if (tryDecodeCustomError(error, errorName, args)) {
      return;
    }

    if (!errorName || !message.includes(errorName)) {
      assert.fail(`Expected error to include ${signature}, got ${message}`);
    }

    if (args.length === 0) {
      return;
    }

    const component = stripQuotes(args[0]);
    const asciiHex = web3.utils.asciiToHex(component);
    const paddedHex = web3.utils.padRight(asciiHex, 66);
    const normalized = message.toLowerCase();
    if (
      normalized.includes(component.toLowerCase()) ||
      normalized.includes(asciiHex.toLowerCase()) ||
      normalized.includes(paddedHex.toLowerCase()) ||
      normalized.includes(paddedHex.slice(2).toLowerCase())
    ) {
      return;
    }

    assert.fail(`Expected error to include ${signature}, got ${message}`);
  }
}

contract('JobRegistry', (accounts) => {
  const [deployer, worker, client, stranger, feeToken, burnAddress, stakeToken] = accounts;

  beforeEach(async function () {
    this.identity = await IdentityRegistry.new({ from: deployer });
    this.stakeManager = await StakeManager.new(stakeToken, 18, { from: deployer });
    this.feePool = await FeePool.new(feeToken, burnAddress, { from: deployer });
    this.validation = await ValidationModule.new({ from: deployer });
    this.dispute = await DisputeModule.new({ from: deployer });
    this.reputation = await ReputationEngine.new({ from: deployer });
    this.certificate = await CertificateNFT.new({ from: deployer });
    this.jobRegistry = await JobRegistry.new({ from: deployer });

    await this.jobRegistry.setModules(
      {
        identity: this.identity.address,
        staking: this.stakeManager.address,
        validation: this.validation.address,
        dispute: this.dispute.address,
        reputation: this.reputation.address,
        feePool: this.feePool.address,
      },
      { from: deployer }
    );
    await this.stakeManager.setJobRegistry(this.jobRegistry.address, { from: deployer });
    await this.feePool.setJobRegistry(this.jobRegistry.address, { from: deployer });
    await this.dispute.setJobRegistry(this.jobRegistry.address, { from: deployer });
    await this.reputation.setJobRegistry(this.jobRegistry.address, { from: deployer });
    await this.jobRegistry.setTimings(3600, 3600, 7200, { from: deployer });
    await this.jobRegistry.setThresholds(6000, 1, 11, 250, 2000, { from: deployer });
  });

  it('stores module addresses correctly', async function () {
    const modules = await this.jobRegistry.modules();
    assert.strictEqual(modules.identity, this.identity.address);
    assert.strictEqual(modules.staking, this.stakeManager.address);
    assert.strictEqual(modules.validation, this.validation.address);
    assert.strictEqual(modules.dispute, this.dispute.address);
    assert.strictEqual(modules.reputation, this.reputation.address);
    assert.strictEqual(modules.feePool, this.feePool.address);
  });

  it('wires dependent modules back to the registry', async function () {
    assert.strictEqual(await this.stakeManager.jobRegistry(), this.jobRegistry.address);
    assert.strictEqual(await this.feePool.jobRegistry(), this.jobRegistry.address);
    assert.strictEqual(await this.dispute.jobRegistry(), this.jobRegistry.address);
    assert.strictEqual(await this.reputation.jobRegistry(), this.jobRegistry.address);
  });

  it('rejects raiseDispute calls from invalid states', async function () {
    await expectRevert.unspecified(this.jobRegistry.raiseDispute(1, { from: client }));

    await this.stakeManager.deposit(web3.utils.toBN('100'), { from: worker });
    const { logs } = await this.jobRegistry.createJob(web3.utils.toBN('100'), { from: client });
    const jobId = logs.find((l) => l.event === 'JobCreated').args.jobId;

    await expectRevert.unspecified(this.jobRegistry.raiseDispute(jobId, { from: client }));
  });

  it('runs through a happy path lifecycle', async function () {
    const stakeAmount = web3.utils.toBN('1000');
    await this.stakeManager.deposit(stakeAmount, { from: worker });

    const receiptCreate = await this.jobRegistry.createJob(stakeAmount, { from: client });
    const jobId = receiptCreate.logs.find((log) => log.event === 'JobCreated').args.jobId;

    const commitSecret = web3.utils.randomHex(32);
    const commitHash = web3.utils.soliditySha3({ type: 'bytes32', value: commitSecret });
    expectEvent(receiptCreate, 'JobCreated', { client });

    const commitReceipt = await this.jobRegistry.commitJob(jobId, commitHash, { from: worker });
    expectEvent(commitReceipt, 'JobCommitted', { jobId, worker });

    const revealReceipt = await this.jobRegistry.revealJob(jobId, commitSecret, { from: worker });
    expectEvent(revealReceipt, 'JobRevealed', { jobId, worker });

    const finalizeReceipt = await this.jobRegistry.finalizeJob(jobId, true, { from: deployer });
    expectEvent(finalizeReceipt, 'JobFinalized', { jobId });

    const locked = await this.stakeManager.lockedAmounts(worker);
    assert.isTrue(locked.isZero(), 'stake should be unlocked');
  });

  it('finalizes without fees when fee bps is zero', async function () {
    await this.jobRegistry.setThresholds(6000, 1, 11, 0, 2000, { from: deployer });
    await this.stakeManager.deposit(web3.utils.toBN('100'), { from: worker });
    const { logs } = await this.jobRegistry.createJob(web3.utils.toBN('100'), { from: client });
    const jobId = logs.find((l) => l.event === 'JobCreated').args.jobId;

    const secret = web3.utils.randomHex(32);
    const hash = web3.utils.soliditySha3({ type: 'bytes32', value: secret });
    await this.jobRegistry.commitJob(jobId, hash, { from: worker });
    await this.jobRegistry.revealJob(jobId, secret, { from: worker });

    const finalizeReceipt = await this.jobRegistry.finalizeJob(jobId, true, { from: deployer });
    expectEvent(finalizeReceipt, 'JobFinalized', { feeAmount: web3.utils.toBN(0) });
  });

  it('enforces commit window', async function () {
    await this.jobRegistry.setTimings(1, 3600, 7200, { from: deployer });
    await this.stakeManager.deposit(web3.utils.toBN('100'), { from: worker });
    const { logs } = await this.jobRegistry.createJob(web3.utils.toBN('100'), { from: client });
    const jobId = logs.find((l) => l.event === 'JobCreated').args.jobId;
    await time.increase(10);
    await expectRevert.unspecified(
      this.jobRegistry.commitJob(jobId, web3.utils.randomHex(32), { from: worker })
    );
  });

  it('caps slash amount during dispute resolution', async function () {
    await this.stakeManager.deposit(web3.utils.toBN('1000'), { from: worker });
    const { logs } = await this.jobRegistry.createJob(web3.utils.toBN('1000'), { from: client });
    const jobId = logs.find((l) => l.event === 'JobCreated').args.jobId;
    const secret = web3.utils.randomHex(32);
    const hash = web3.utils.soliditySha3({ type: 'bytes32', value: secret });
    await this.jobRegistry.commitJob(jobId, hash, { from: worker });
    await this.jobRegistry.revealJob(jobId, secret, { from: worker });
    await this.jobRegistry.raiseDispute(jobId, { from: client });

    await expectRevert(
      this.jobRegistry.resolveDispute(jobId, true, 1001, 0, { from: deployer }),
      'JobRegistry: slash bounds'
    );
  });

  it('validates configuration inputs', async function () {
    await expectRevert(
      this.jobRegistry.setModules(
        {
          identity: constants.ZERO_ADDRESS,
          staking: this.stakeManager.address,
          validation: this.validation.address,
          dispute: this.dispute.address,
          reputation: this.reputation.address,
          feePool: this.feePool.address,
        },
        { from: deployer }
      ),
      'JobRegistry: identity'
    );

    await expectRevert(
      this.jobRegistry.setModules(
        {
          identity: this.identity.address,
          staking: constants.ZERO_ADDRESS,
          validation: this.validation.address,
          dispute: this.dispute.address,
          reputation: this.reputation.address,
          feePool: this.feePool.address,
        },
        { from: deployer }
      ),
      'JobRegistry: staking'
    );

    await expectRevert(
      this.jobRegistry.setModules(
        {
          identity: this.identity.address,
          staking: this.stakeManager.address,
          validation: this.validation.address,
          dispute: this.dispute.address,
          reputation: this.reputation.address,
          feePool: constants.ZERO_ADDRESS,
        },
        { from: deployer }
      ),
      'JobRegistry: feePool'
    );

    await expectRevert(
      this.jobRegistry.setTimings(0, 1, 1, { from: deployer }),
      'JobRegistry: timings'
    );
    await expectRevert(
      this.jobRegistry.setThresholds(6000, 0, 11, 250, 2000, { from: deployer }),
      'JobRegistry: quorum'
    );
    await expectRevert(
      this.jobRegistry.setThresholds(6000, 1, 11, 20000, 2000, { from: deployer }),
      'JobRegistry: fee bps'
    );
    await expectRevert(
      this.jobRegistry.setThresholds(6000, 1, 11, 250, 20000, { from: deployer }),
      'JobRegistry: slash bps'
    );
  });

  it('validates lifecycle error paths', async function () {
    await expectRevert(
      this.jobRegistry.createJob('0', { from: client }),
      'JobRegistry: stake amount'
    );

    await this.jobRegistry.setTimings(2, 2, 5, { from: deployer });
    await this.stakeManager.deposit('200', { from: worker });
    const { logs } = await this.jobRegistry.createJob('200', { from: client });
    const jobId = logs.find((l) => l.event === 'JobCreated').args.jobId;
    const secret = web3.utils.randomHex(32);
    const hash = web3.utils.soliditySha3({ type: 'bytes32', value: secret });
    await this.jobRegistry.commitJob(jobId, hash, { from: worker });

    await expectRevert.unspecified(this.jobRegistry.commitJob(jobId, hash, { from: worker }));

    await expectRevert(
      this.jobRegistry.revealJob(jobId, secret, { from: stranger }),
      'JobRegistry: not worker'
    );

    await expectRevert(
      this.jobRegistry.revealJob(jobId, web3.utils.randomHex(32), { from: worker }),
      'JobRegistry: commit mismatch'
    );

    await time.increase(5);
    await expectRevert.unspecified(this.jobRegistry.revealJob(jobId, secret, { from: worker }));
  });

  it('handles finalize and dispute windows across branches', async function () {
    await this.jobRegistry.setTimings(2, 2, 2, { from: deployer });
    await this.jobRegistry.setThresholds(6000, 1, 11, 0, 5000, { from: deployer });
    await this.stakeManager.deposit('500', { from: worker });
    const { logs } = await this.jobRegistry.createJob('500', { from: client });
    const jobId = logs.find((l) => l.event === 'JobCreated').args.jobId;
    const secret = web3.utils.randomHex(32);
    const hash = web3.utils.soliditySha3({ type: 'bytes32', value: secret });
    await expectRevert.unspecified(this.jobRegistry.raiseDispute(jobId, { from: client }));
    await this.jobRegistry.commitJob(jobId, hash, { from: worker });
    await this.jobRegistry.revealJob(jobId, secret, { from: worker });

    await expectRevert.unspecified(this.jobRegistry.finalizeJob(jobId, true, { from: stranger }));

    const finalizeZeroFee = await this.jobRegistry.finalizeJob(jobId, true, { from: deployer });
    expectEvent(finalizeZeroFee, 'JobFinalized', { feeAmount: web3.utils.toBN(0) });

    // recreate job for dispute path
    const second = await this.jobRegistry.createJob('400', { from: client });
    const disputedJobId = second.logs.find((l) => l.event === 'JobCreated').args.jobId;
    const disputeSecret = web3.utils.randomHex(32);
    const disputeHash = web3.utils.soliditySha3({ type: 'bytes32', value: disputeSecret });
    await this.jobRegistry.commitJob(disputedJobId, disputeHash, { from: worker });
    await this.jobRegistry.revealJob(disputedJobId, disputeSecret, { from: worker });
    const disputedJob = await this.jobRegistry.jobs(disputedJobId);
    await time.increaseTo(disputedJob.disputeDeadline.toNumber() + 1);
    await expectRevert.unspecified(this.jobRegistry.raiseDispute(disputedJobId, { from: client }));
  });

  it('prevents finalize from invalid states', async function () {
    const { logs } = await this.jobRegistry.createJob('200', { from: client });
    const jobId = logs.find((l) => l.event === 'JobCreated').args.jobId;

    await expectRevert.unspecified(this.jobRegistry.finalizeJob(jobId, true, { from: deployer }));

    const secret = web3.utils.randomHex(32);
    const hash = web3.utils.soliditySha3({ type: 'bytes32', value: secret });
    await this.stakeManager.deposit('200', { from: worker });
    await this.jobRegistry.commitJob(jobId, hash, { from: worker });

    await expectRevert.unspecified(this.jobRegistry.finalizeJob(jobId, true, { from: deployer }));
  });

  it('resolves disputes in both slash and release modes', async function () {
    await this.jobRegistry.setTimings(2, 2, 10, { from: deployer });
    await this.jobRegistry.setThresholds(6000, 1, 11, 250, 5000, { from: deployer });
    await this.stakeManager.deposit('600', { from: worker });
    const { logs } = await this.jobRegistry.createJob('600', { from: client });
    const jobId = logs.find((l) => l.event === 'JobCreated').args.jobId;
    const secret = web3.utils.randomHex(32);
    const hash = web3.utils.soliditySha3({ type: 'bytes32', value: secret });
    await this.jobRegistry.commitJob(jobId, hash, { from: worker });
    await this.jobRegistry.revealJob(jobId, secret, { from: worker });
    await this.jobRegistry.raiseDispute(jobId, { from: client });

    const slashReceipt = await this.jobRegistry.resolveDispute(jobId, true, 300, -5, {
      from: deployer,
    });
    expectEvent(slashReceipt, 'DisputeResolved', {
      slashed: true,
      slashAmount: web3.utils.toBN(300),
    });

    await this.stakeManager.deposit('400', { from: worker });
    const next = await this.jobRegistry.createJob('400', { from: client });
    const jobId2 = next.logs.find((l) => l.event === 'JobCreated').args.jobId;
    const secret2 = web3.utils.randomHex(32);
    const hash2 = web3.utils.soliditySha3({ type: 'bytes32', value: secret2 });
    await this.jobRegistry.commitJob(jobId2, hash2, { from: worker });
    await this.jobRegistry.revealJob(jobId2, secret2, { from: worker });
    await this.jobRegistry.raiseDispute(jobId2, { from: client });

    const releaseReceipt = await this.jobRegistry.resolveDispute(jobId2, false, 0, 7, {
      from: deployer,
    });
    expectEvent(releaseReceipt, 'DisputeResolved', {
      slashed: false,
      slashAmount: web3.utils.toBN(0),
    });
    assert.strictEqual((await this.reputation.reputation(worker)).toString(), '2');

    await this.stakeManager.deposit('500', { from: worker });
    const neutral = await this.jobRegistry.createJob('500', { from: client });
    const jobId3 = neutral.logs.find((l) => l.event === 'JobCreated').args.jobId;
    const neutralSecret = web3.utils.randomHex(32);
    const neutralHash = web3.utils.soliditySha3({ type: 'bytes32', value: neutralSecret });
    await this.jobRegistry.commitJob(jobId3, neutralHash, { from: worker });
    await this.jobRegistry.revealJob(jobId3, neutralSecret, { from: worker });
    await this.jobRegistry.raiseDispute(jobId3, { from: client });

    const neutralReceipt = await this.jobRegistry.resolveDispute(jobId3, false, 0, 0, {
      from: deployer,
    });
    expectEvent(neutralReceipt, 'DisputeResolved', {
      slashed: false,
      slashAmount: web3.utils.toBN(0),
    });
    assert.strictEqual((await this.reputation.reputation(worker)).toString(), '2');
  });

  describe('configuration gating', () => {
    beforeEach(async function () {
      this.identity = await IdentityRegistry.new({ from: deployer });
      this.stakeManager = await StakeManager.new(stakeToken, 18, { from: deployer });
      this.feePool = await FeePool.new(feeToken, burnAddress, { from: deployer });
      this.validation = await ValidationModule.new({ from: deployer });
      this.dispute = await DisputeModule.new({ from: deployer });
      this.reputation = await ReputationEngine.new({ from: deployer });
      this.jobRegistry = await JobRegistry.new({ from: deployer });
    });

    it('reports configuration status across lifecycle phases', async function () {
      const initial = await this.jobRegistry.configurationStatus();
      assert.isFalse(initial.modulesConfigured);
      assert.isFalse(initial.timingsConfigured);
      assert.isFalse(initial.thresholdsConfigured);
      assert.isFalse(await this.jobRegistry.isFullyConfigured());

      await this.jobRegistry.setModules(
        {
          identity: this.identity.address,
          staking: this.stakeManager.address,
          validation: this.validation.address,
          dispute: this.dispute.address,
          reputation: this.reputation.address,
          feePool: this.feePool.address,
        },
        { from: deployer }
      );

      const afterModules = await this.jobRegistry.configurationStatus();
      assert.isTrue(afterModules.modulesConfigured);
      assert.isFalse(afterModules.timingsConfigured);
      assert.isFalse(afterModules.thresholdsConfigured);
      assert.isFalse(await this.jobRegistry.isFullyConfigured());

      await this.jobRegistry.setTimings(3600, 3600, 7200, { from: deployer });
      const afterTimings = await this.jobRegistry.configurationStatus();
      assert.isTrue(afterTimings.modulesConfigured);
      assert.isTrue(afterTimings.timingsConfigured);
      assert.isFalse(afterTimings.thresholdsConfigured);
      assert.isFalse(await this.jobRegistry.isFullyConfigured());

      await this.jobRegistry.setThresholds(6000, 1, 11, 250, 2000, { from: deployer });
      const afterThresholds = await this.jobRegistry.configurationStatus();
      assert.isTrue(afterThresholds.modulesConfigured);
      assert.isTrue(afterThresholds.timingsConfigured);
      assert.isTrue(afterThresholds.thresholdsConfigured);
      assert.isTrue(await this.jobRegistry.isFullyConfigured());
    });

    it('prevents lifecycle interactions until fully configured', async function () {
      await expectCustomError(
        this.jobRegistry.createJob('100', { from: client }),
        'JobRegistry.NotConfigured("modules")'
      );

      await this.jobRegistry.setModules(
        {
          identity: this.identity.address,
          staking: this.stakeManager.address,
          validation: this.validation.address,
          dispute: this.dispute.address,
          reputation: this.reputation.address,
          feePool: this.feePool.address,
        },
        { from: deployer }
      );

      await expectCustomError(
        this.jobRegistry.createJob('100', { from: client }),
        'JobRegistry.NotConfigured("timings")'
      );

      await this.jobRegistry.setTimings(3600, 3600, 7200, { from: deployer });

      await expectCustomError(
        this.jobRegistry.createJob('100', { from: client }),
        'JobRegistry.NotConfigured("thresholds")'
      );

      await this.jobRegistry.setThresholds(6000, 1, 11, 250, 2000, { from: deployer });

      await this.stakeManager.setJobRegistry(this.jobRegistry.address, { from: deployer });
      await this.feePool.setJobRegistry(this.jobRegistry.address, { from: deployer });
      await this.dispute.setJobRegistry(this.jobRegistry.address, { from: deployer });
      await this.reputation.setJobRegistry(this.jobRegistry.address, { from: deployer });
      await this.stakeManager.deposit('150', { from: worker });

      const receipt = await this.jobRegistry.createJob('150', { from: client });
      expectEvent(receipt, 'JobCreated', { client });
    });
  });
});
