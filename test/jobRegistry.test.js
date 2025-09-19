const { expectRevert, time, expectEvent, constants } = require('@openzeppelin/test-helpers');
const IdentityRegistry = artifacts.require('IdentityRegistry');
const StakeManager = artifacts.require('StakeManager');
const FeePool = artifacts.require('FeePool');
const ValidationModule = artifacts.require('ValidationModule');
const DisputeModule = artifacts.require('DisputeModule');
const ReputationEngine = artifacts.require('ReputationEngine');
const CertificateNFT = artifacts.require('CertificateNFT');
const JobRegistry = artifacts.require('JobRegistry');
const MockERC20 = artifacts.require('MockERC20');

contract('JobRegistry', (accounts) => {
  const [deployer, worker, client, stranger, burn] = accounts;

  beforeEach(async function () {
    this.token = await MockERC20.new('Stake Token', 'STK', 18, { from: deployer });
    this.identity = await IdentityRegistry.new({ from: deployer });
    this.stakeManager = await StakeManager.new(this.token.address, 18, { from: deployer });
    this.feePool = await FeePool.new(this.token.address, burn, { from: deployer });
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
        feePool: this.feePool.address
      },
      { from: deployer }
    );
    await this.stakeManager.setJobRegistry(this.jobRegistry.address, { from: deployer });
    await this.stakeManager.setFeePool(this.feePool.address, { from: deployer });
    await this.feePool.setJobRegistry(this.jobRegistry.address, { from: deployer });
    await this.feePool.setStakeManager(this.stakeManager.address, { from: deployer });
    await this.dispute.setJobRegistry(this.jobRegistry.address, { from: deployer });
    await this.reputation.setJobRegistry(this.jobRegistry.address, { from: deployer });
    await this.jobRegistry.setTimings(3600, 3600, 7200, { from: deployer });
    await this.jobRegistry.setThresholds(6000, 1, 11, 250, 2000, { from: deployer });

    await this.token.mint(worker, web3.utils.toBN('5000'), { from: deployer });
    await this.token.approve(this.stakeManager.address, web3.utils.toBN('5000'), { from: worker });
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
    const feeAmount = stakeAmount.muln(250).divn(10000);
    assert.strictEqual((await this.token.balanceOf(burn)).toString(), feeAmount.toString());
    assert.strictEqual((await this.feePool.totalFeesRecorded()).toString(), feeAmount.toString());
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
          feePool: this.feePool.address
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
          feePool: this.feePool.address
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
          feePool: constants.ZERO_ADDRESS
        },
        { from: deployer }
      ),
      'JobRegistry: feePool'
    );

    await expectRevert(this.jobRegistry.setTimings(0, 1, 1, { from: deployer }), 'JobRegistry: timings');
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
    await expectRevert(this.jobRegistry.createJob('0', { from: client }), 'JobRegistry: stake amount');

    await this.jobRegistry.setTimings(2, 2, 5, { from: deployer });
    await this.stakeManager.deposit('200', { from: worker });
    const { logs } = await this.jobRegistry.createJob('200', { from: client });
    const jobId = logs.find((l) => l.event === 'JobCreated').args.jobId;
    const secret = web3.utils.randomHex(32);
    const hash = web3.utils.soliditySha3({ type: 'bytes32', value: secret });
    await this.jobRegistry.commitJob(jobId, hash, { from: worker });

    await expectRevert.unspecified(
      this.jobRegistry.commitJob(jobId, hash, { from: worker })
    );

    await expectRevert(
      this.jobRegistry.revealJob(jobId, secret, { from: stranger }),
      'JobRegistry: not worker'
    );

    await expectRevert(
      this.jobRegistry.revealJob(jobId, web3.utils.randomHex(32), { from: worker }),
      'JobRegistry: commit mismatch'
    );

    await time.increase(5);
    await expectRevert.unspecified(
      this.jobRegistry.revealJob(jobId, secret, { from: worker })
    );
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

    await expectRevert.unspecified(
      this.jobRegistry.finalizeJob(jobId, true, { from: stranger })
    );

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

    const slashReceipt = await this.jobRegistry.resolveDispute(jobId, true, 300, -5, { from: deployer });
    expectEvent(slashReceipt, 'DisputeResolved', { slashed: true, slashAmount: web3.utils.toBN(300) });

    await this.stakeManager.deposit('400', { from: worker });
    const next = await this.jobRegistry.createJob('400', { from: client });
    const jobId2 = next.logs.find((l) => l.event === 'JobCreated').args.jobId;
    const secret2 = web3.utils.randomHex(32);
    const hash2 = web3.utils.soliditySha3({ type: 'bytes32', value: secret2 });
    await this.jobRegistry.commitJob(jobId2, hash2, { from: worker });
    await this.jobRegistry.revealJob(jobId2, secret2, { from: worker });
    await this.jobRegistry.raiseDispute(jobId2, { from: client });

    const releaseReceipt = await this.jobRegistry.resolveDispute(jobId2, false, 0, 7, { from: deployer });
    expectEvent(releaseReceipt, 'DisputeResolved', { slashed: false, slashAmount: web3.utils.toBN(0) });
    assert.strictEqual((await this.reputation.reputation(worker)).toString(), '2');
  });
});
