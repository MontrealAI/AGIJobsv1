const { expectRevert, time, expectEvent, constants } = require('@openzeppelin/test-helpers');
const IdentityRegistry = artifacts.require('IdentityRegistry');
const StakeManager = artifacts.require('StakeManager');
const FeePool = artifacts.require('FeePool');
const ValidationModule = artifacts.require('ValidationModule');
const DisputeModule = artifacts.require('DisputeModule');
const ReputationEngine = artifacts.require('ReputationEngine');
const CertificateNFT = artifacts.require('CertificateNFT');
const JobRegistry = artifacts.require('JobRegistry');

contract('JobRegistry', (accounts) => {
  const [deployer, worker, client, stranger] = accounts;

  beforeEach(async function () {
    this.identity = await IdentityRegistry.new({ from: deployer });
    this.stakeManager = await StakeManager.new(constants.ZERO_ADDRESS, 18, { from: deployer });
    this.feePool = await FeePool.new(constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, { from: deployer });
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

  it('enforces commit window', async function () {
    await this.jobRegistry.setTimings(1, 3600, 7200, { from: deployer });
    await this.stakeManager.deposit(web3.utils.toBN('100'), { from: worker });
    const { logs } = await this.jobRegistry.createJob(web3.utils.toBN('100'), { from: client });
    const jobId = logs.find((l) => l.event === 'JobCreated').args.jobId;
    await time.increase(5);
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
});
