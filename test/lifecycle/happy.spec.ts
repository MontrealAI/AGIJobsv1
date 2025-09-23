import { BN, expectEvent } from '@openzeppelin/test-helpers';

const JobRegistry = artifacts.require('JobRegistry');
const StakeManager = artifacts.require('StakeManager');
const FeePool = artifacts.require('FeePool');
const ValidationModule = artifacts.require('ValidationModule');
const DisputeModule = artifacts.require('DisputeModule');
const ReputationEngine = artifacts.require('ReputationEngine');
const IdentityRegistry = artifacts.require('IdentityRegistry');
const MockERC20 = artifacts.require('MockERC20');

declare const artifacts: any;
declare const contract: any;
declare const web3: any;

contract('Lifecycle / happy path', (accounts: string[]) => {
  const [deployer, client, worker, validator, burn] = accounts;
  const stakeAmount = new BN('1000');

  beforeEach(async function (this: any) {
    this.identity = await IdentityRegistry.new({ from: deployer });
    this.token = await MockERC20.new('Stake Token', 'STK', 18, worker, stakeAmount.mul(new BN('100')), {
      from: deployer,
    });
    this.stakeManager = await StakeManager.new(this.token.address, 18, { from: deployer });
    this.feePool = await FeePool.new(this.token.address, burn, { from: deployer });
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

    await this.stakeManager.setJobRegistry(this.jobRegistry.address, { from: deployer });
    await this.stakeManager.setFeeRecipient(this.feePool.address, { from: deployer });
    await this.feePool.setJobRegistry(this.jobRegistry.address, { from: deployer });
    await this.validation.setJobRegistry(this.jobRegistry.address, { from: deployer });
    await this.dispute.setJobRegistry(this.jobRegistry.address, { from: deployer });
    await this.reputation.setJobRegistry(this.jobRegistry.address, { from: deployer });

    await this.jobRegistry.setTimings(3600, 3600, 7200, { from: deployer });
    await this.jobRegistry.setThresholds(6000, 1, 11, 250, 2000, { from: deployer });

    await this.token.approve(this.stakeManager.address, stakeAmount.mul(new BN('10')), { from: worker });
  });

  it('executes the full happy-path lifecycle with validator attestations', async function (this: any) {
    await this.stakeManager.deposit(stakeAmount, { from: worker });

    const createReceipt = await this.jobRegistry.createJob(stakeAmount, { from: client });
    const jobId = createReceipt.logs.find((log: any) => log.event === 'JobCreated').args.jobId as BN;

    const workSecret = web3.utils.randomHex(32);
    const workHash = web3.utils.soliditySha3({ type: 'bytes32', value: workSecret }) as string;
    await this.jobRegistry.commitJob(jobId, workHash, { from: worker });

    const voteSalt = web3.utils.randomHex(32);
    const commitHash = await this.validation.computeCommitment(jobId, validator, true, voteSalt);
    const commitReceipt = await this.validation.commitValidation(jobId, commitHash, { from: validator });
    expectEvent(commitReceipt, 'ValidationCommitted', { jobId, validator });

    const revealReceipt = await this.jobRegistry.revealJob(jobId, workSecret, { from: worker });
    expectEvent(revealReceipt, 'JobRevealed', { jobId, worker });

    const validationReveal = await this.validation.revealValidation(jobId, true, voteSalt, { from: validator });
    expectEvent(validationReveal, 'ValidationRevealed', { jobId, validator, approved: true });

    const approvals = await this.validation.approvals(jobId);
    assert(approvals.eq(new BN(1)));
    const commitRecord = await this.validation.commitOf(jobId, validator);
    assert.strictEqual(
      commitRecord,
      '0x0000000000000000000000000000000000000000000000000000000000000000'
    );
    const hasRevealed = await this.validation.hasRevealed(jobId, validator);
    assert.strictEqual(hasRevealed, true);

    const finalizeReceipt = await this.jobRegistry.finalizeJob(jobId, true, { from: deployer });
    expectEvent(finalizeReceipt, 'JobFinalized', { jobId, success: true });
    const closed = await this.validation.isJobClosed(jobId);
    assert.strictEqual(closed, true);
  });

  it('records validator rejections and clears commits after reveal', async function (this: any) {
    await this.stakeManager.deposit(stakeAmount, { from: worker });
    const createReceipt = await this.jobRegistry.createJob(stakeAmount, { from: client });
    const jobId = createReceipt.logs.find((log: any) => log.event === 'JobCreated').args.jobId as BN;

    const workSecret = web3.utils.randomHex(32);
    const workHash = web3.utils.soliditySha3({ type: 'bytes32', value: workSecret }) as string;
    await this.jobRegistry.commitJob(jobId, workHash, { from: worker });
    await this.jobRegistry.revealJob(jobId, workSecret, { from: worker });

    const salt = web3.utils.randomHex(32);
    const commitHash = await this.validation.computeCommitment(jobId, validator, false, salt);
    await this.validation.commitValidation(jobId, commitHash, { from: validator });

    const pendingBefore = await this.validation.pendingCommitCount(jobId);
    assert(pendingBefore.eq(new BN(1)));

    await this.validation.revealValidation(jobId, false, salt, { from: validator });
    const rejections = await this.validation.rejections(jobId);
    assert(rejections.eq(new BN(1)));

    const pendingAfter = await this.validation.pendingCommitCount(jobId);
    assert(pendingAfter.isZero());
    const vote = await this.validation.voteOf(jobId, validator);
    assert.strictEqual(vote, false);
  });
});
