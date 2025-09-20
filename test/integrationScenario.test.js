const { expectEvent, expectRevert, BN } = require('@openzeppelin/test-helpers');
const IdentityRegistry = artifacts.require('IdentityRegistry');
const StakeManager = artifacts.require('StakeManager');
const FeePool = artifacts.require('FeePool');
const ValidationModule = artifacts.require('ValidationModule');
const DisputeModule = artifacts.require('DisputeModule');
const ReputationEngine = artifacts.require('ReputationEngine');
const JobRegistry = artifacts.require('JobRegistry');
const MockERC20 = artifacts.require('MockERC20');
const WorkerActor = artifacts.require('WorkerActor');
const ClientActor = artifacts.require('ClientActor');

contract('Protocol integration scenarios', (accounts) => {
  const [deployer, worker, client, emergency, feeSink] = accounts;
  const initialMint = new BN('1000000');

  beforeEach(async function () {
    this.identity = await IdentityRegistry.new({ from: deployer });
    this.token = await MockERC20.new('Stake', 'STK', 18, { from: deployer });
    await this.token.mint(worker, initialMint, { from: deployer });
    this.stakeManager = await StakeManager.new(this.token.address, 18, { from: deployer });
    this.feePool = await FeePool.new(this.token.address, feeSink, { from: deployer });
    this.validation = await ValidationModule.new({ from: deployer });
    this.dispute = await DisputeModule.new({ from: deployer });
    this.reputation = await ReputationEngine.new({ from: deployer });
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
    await this.jobRegistry.setTimings(3600, 3600, 7200, { from: deployer });
    await this.jobRegistry.setThresholds(6000, 1, 11, 250, 2000, { from: deployer });

    await this.stakeManager.setJobRegistry(this.jobRegistry.address, { from: deployer });
    await this.stakeManager.setFeeRecipient(this.feePool.address, { from: deployer });
    await this.feePool.setJobRegistry(this.jobRegistry.address, { from: deployer });
    await this.dispute.setJobRegistry(this.jobRegistry.address, { from: deployer });
    await this.reputation.setJobRegistry(this.jobRegistry.address, { from: deployer });

    await this.token.approve(this.stakeManager.address, initialMint, { from: worker });
  });

  it('runs a full lifecycle with payouts and withdrawals', async function () {
    const stakeAmount = new BN('2000');
    await this.stakeManager.deposit(stakeAmount, { from: worker });
    assert.strictEqual((await this.stakeManager.availableStake(worker)).toString(), stakeAmount.toString());

    const createTx = await this.jobRegistry.createJob(stakeAmount, { from: client });
    const jobId = createTx.logs.find((l) => l.event === 'JobCreated').args.jobId;
    const secret = web3.utils.randomHex(32);
    const hash = web3.utils.soliditySha3({ type: 'bytes32', value: secret });
    await this.jobRegistry.commitJob(jobId, hash, { from: worker });
    await this.jobRegistry.revealJob(jobId, secret, { from: worker });

    const finalizeReceipt = await this.jobRegistry.finalizeJob(jobId, true, { from: deployer });
    const expectedFee = stakeAmount.muln(250).divn(10000);
    expectEvent(finalizeReceipt, 'JobFinalized', { jobId, feeAmount: expectedFee });

    const totalDeposits = await this.stakeManager.totalDeposits(worker);
    assert.strictEqual(totalDeposits.toString(), stakeAmount.sub(expectedFee).toString());
    assert.strictEqual((await this.stakeManager.lockedAmounts(worker)).toString(), '0');
    assert.strictEqual((await this.feePool.totalFeesRecorded()).toString(), expectedFee.toString());

    const withdrawAmount = stakeAmount.sub(expectedFee);
    const balanceBefore = await this.token.balanceOf(worker);
    await this.stakeManager.withdraw(withdrawAmount, { from: worker });
    const balanceAfter = await this.token.balanceOf(worker);
    assert.strictEqual(balanceAfter.sub(balanceBefore).toString(), withdrawAmount.toString());
  });

  it('handles disputed jobs with slashing and reputation adjustments', async function () {
    const stakeAmount = new BN('1500');
    await this.stakeManager.deposit(stakeAmount, { from: worker });

    const createTx = await this.jobRegistry.createJob(stakeAmount, { from: client });
    const jobId = createTx.logs.find((l) => l.event === 'JobCreated').args.jobId;
    const secret = web3.utils.randomHex(32);
    const hash = web3.utils.soliditySha3({ type: 'bytes32', value: secret });
    await this.jobRegistry.commitJob(jobId, hash, { from: worker });
    await this.jobRegistry.revealJob(jobId, secret, { from: worker });

    const disputeReceipt = await this.jobRegistry.raiseDispute(jobId, { from: client });
    expectEvent(disputeReceipt, 'JobDisputed', { jobId, raiser: client });

    const slashAmount = stakeAmount.muln(20).divn(100); // 20% slash
    const reputationDelta = -15;
    const resolveReceipt = await this.jobRegistry.resolveDispute(jobId, true, slashAmount, reputationDelta, {
      from: deployer,
    });
    expectEvent(resolveReceipt, 'DisputeResolved', {
      jobId,
      slashed: true,
      slashAmount,
    });

    assert.strictEqual((await this.stakeManager.lockedAmounts(worker)).toString(), '0');
    const depositsAfter = await this.stakeManager.totalDeposits(worker);
    assert.strictEqual(depositsAfter.toString(), stakeAmount.sub(slashAmount).toString());
    assert.strictEqual((await this.reputation.reputation(worker)).toString(), reputationDelta.toString());

    const poolBalance = await this.token.balanceOf(this.feePool.address);
    assert.strictEqual(poolBalance.toString(), slashAmount.toString());
    assert.strictEqual((await this.feePool.totalFeesRecorded()).toString(), '0');

    const availableAfter = await this.stakeManager.availableStake(worker);
    assert.strictEqual(availableAfter.toString(), stakeAmount.sub(slashAmount).toString());
    await this.stakeManager.withdraw(availableAfter, { from: worker });

    await expectRevert.unspecified(this.jobRegistry.raiseDispute(jobId, { from: emergency }));
  });

  it('supports actor-driven disputes that resolve without slashing', async function () {
    const workerActor = await WorkerActor.new(
      this.stakeManager.address,
      this.jobRegistry.address,
      this.token.address,
      { from: worker }
    );
    const clientActor = await ClientActor.new(this.jobRegistry.address, { from: client });

    const stakeAmount = new BN('800');
    await this.token.transfer(workerActor.address, stakeAmount, { from: worker });

    await workerActor.deposit(stakeAmount, { from: worker });

    await clientActor.createJob(stakeAmount, { from: client });
    const jobId = await this.jobRegistry.totalJobs();

    const secret = web3.utils.randomHex(32);
    const commitHash = web3.utils.soliditySha3({ type: 'bytes32', value: secret });
    await workerActor.commit(jobId, commitHash, { from: worker });

    await clientActor.raiseDispute(jobId, { from: client });

    const resolution = await this.jobRegistry.resolveDispute(jobId, false, 0, -5, { from: deployer });
    expectEvent(resolution, 'DisputeResolved', {
      jobId,
      slashed: false,
      slashAmount: new BN('0'),
    });

    const availableStake = await this.stakeManager.availableStake(workerActor.address);
    assert.strictEqual(availableStake.toString(), stakeAmount.toString());
    assert.strictEqual((await this.feePool.totalFeesRecorded()).toString(), '0');

    await workerActor.withdraw(stakeAmount, { from: worker });
    assert.strictEqual((await this.token.balanceOf(workerActor.address)).toString(), stakeAmount.toString());
    assert.strictEqual((await this.reputation.reputation(workerActor.address)).toString(), '-5');
  });
});
