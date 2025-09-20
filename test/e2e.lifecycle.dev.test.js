const { expectEvent, BN } = require('@openzeppelin/test-helpers');
const MockERC20 = artifacts.require('MockERC20');
const StakeManager = artifacts.require('StakeManager');
const JobRegistry = artifacts.require('JobRegistry');
const FeePool = artifacts.require('FeePool');

contract('Development lifecycle e2e', (accounts) => {
  const [governance, agent, validator, client] = accounts;
  const agentStake = new BN(web3.utils.toWei('1000'));
  const validatorStake = new BN(web3.utils.toWei('500'));
  const jobStake = new BN(web3.utils.toWei('300'));
  const bpsDenominator = new BN('10000');

  before(async function () {
    this.token = await MockERC20.deployed();
    this.stakeManager = await StakeManager.deployed();
    this.jobRegistry = await JobRegistry.deployed();
    this.feePool = await FeePool.deployed();
  });

  it('distributes stake and completes commit/reveal lifecycle on development network', async function () {
    const status = await this.jobRegistry.configurationStatus();
    assert.isTrue(status.modulesConfigured, 'modules should be configured');
    assert.isTrue(status.timingsConfigured, 'timings should be configured');
    assert.isTrue(status.thresholdsConfigured, 'thresholds should be configured');

    const govBalanceBefore = await this.token.balanceOf(governance);
    assert.isTrue(
      govBalanceBefore.gte(agentStake.add(validatorStake)),
      'governance should hold the initial mock AGIALPHA supply'
    );

    assert.strictEqual((await this.stakeManager.totalDeposits(agent)).toString(), '0');
    assert.strictEqual((await this.stakeManager.totalDeposits(validator)).toString(), '0');

    const agentTransfer = await this.token.transfer(agent, agentStake, { from: governance });
    expectEvent(agentTransfer, 'Transfer', { from: governance, to: agent, value: agentStake });
    const validatorTransfer = await this.token.transfer(validator, validatorStake, { from: governance });
    expectEvent(validatorTransfer, 'Transfer', { from: governance, to: validator, value: validatorStake });

    assert.strictEqual((await this.token.balanceOf(agent)).toString(), agentStake.toString());
    assert.strictEqual((await this.token.balanceOf(validator)).toString(), validatorStake.toString());

    await this.token.approve(this.stakeManager.address, agentStake, { from: agent });
    const agentDeposit = await this.stakeManager.deposit(agentStake, { from: agent });
    expectEvent(agentDeposit, 'Deposited', { account: agent, amount: agentStake });
    assert.strictEqual((await this.stakeManager.availableStake(agent)).toString(), agentStake.toString());

    await this.token.approve(this.stakeManager.address, validatorStake, { from: validator });
    const validatorDeposit = await this.stakeManager.deposit(validatorStake, { from: validator });
    expectEvent(validatorDeposit, 'Deposited', { account: validator, amount: validatorStake });
    assert.strictEqual((await this.stakeManager.availableStake(validator)).toString(), validatorStake.toString());

    const createReceipt = await this.jobRegistry.createJob(jobStake, { from: client });
    const jobId = createReceipt.logs.find((log) => log.event === 'JobCreated').args.jobId;
    expectEvent(createReceipt, 'JobCreated', { jobId, client, stakeAmount: jobStake });

    const commitSecret = web3.utils.randomHex(32);
    const commitHash = web3.utils.soliditySha3({ type: 'bytes32', value: commitSecret });
    const commitReceipt = await this.jobRegistry.commitJob(jobId, commitHash, { from: agent });
    expectEvent(commitReceipt, 'JobCommitted', { jobId, worker: agent, commitHash });

    assert.strictEqual((await this.stakeManager.lockedAmounts(agent)).toString(), jobStake.toString());
    assert.strictEqual(
      (await this.stakeManager.availableStake(agent)).toString(),
      agentStake.sub(jobStake).toString()
    );

    const revealReceipt = await this.jobRegistry.revealJob(jobId, commitSecret, { from: agent });
    expectEvent(revealReceipt, 'JobRevealed', { jobId, worker: agent });

    const thresholds = await this.jobRegistry.thresholds();
    const feeBps = new BN(thresholds.feeBps);
    const expectedFee = jobStake.mul(feeBps).div(bpsDenominator);
    const releaseAmount = jobStake.sub(expectedFee);

    const finalizeReceipt = await this.jobRegistry.finalizeJob(jobId, true, { from: governance });
    expectEvent(finalizeReceipt, 'JobFinalized', { jobId, success: true, feeAmount: expectedFee });

    await expectEvent.inTransaction(finalizeReceipt.tx, StakeManager, 'Slashed', {
      account: agent,
      amount: expectedFee,
    });
    await expectEvent.inTransaction(finalizeReceipt.tx, StakeManager, 'Released', {
      account: agent,
      amount: releaseAmount,
    });
    await expectEvent.inTransaction(finalizeReceipt.tx, FeePool, 'FeeRecorded', {
      amount: expectedFee,
    });

    assert.strictEqual((await this.stakeManager.lockedAmounts(agent)).toString(), '0');
    assert.strictEqual(
      (await this.stakeManager.totalDeposits(agent)).toString(),
      agentStake.sub(expectedFee).toString()
    );
    assert.strictEqual(
      (await this.stakeManager.availableStake(agent)).toString(),
      agentStake.sub(expectedFee).toString()
    );
    assert.strictEqual((await this.stakeManager.availableStake(validator)).toString(), validatorStake.toString());

    assert.strictEqual((await this.token.balanceOf(this.feePool.address)).toString(), expectedFee.toString());
    assert.strictEqual((await this.feePool.totalFeesRecorded()).toString(), expectedFee.toString());

    const govBalanceAfter = await this.token.balanceOf(governance);
    assert.strictEqual(
      govBalanceAfter.toString(),
      govBalanceBefore.sub(agentStake).sub(validatorStake).toString()
    );
  });
});
