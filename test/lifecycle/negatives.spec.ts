import { BN, expectEvent, expectRevert, time } from '@openzeppelin/test-helpers';

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

contract('Lifecycle / negatives', (accounts: string[]) => {
  const [deployer, client, worker, validator, burn, stranger] = accounts;
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

  it('rejects validator reveals without a prior commit', async function (this: any) {
    await expectRevert.unspecified(this.validation.revealValidation(1, true, web3.utils.randomHex(32), { from: validator }));
  });

  it('prevents duplicate validator commits for the same job', async function (this: any) {
    await this.stakeManager.deposit(stakeAmount, { from: worker });
    const createReceipt = await this.jobRegistry.createJob(stakeAmount, { from: client });
    const jobId = createReceipt.logs.find((log: any) => log.event === 'JobCreated').args.jobId as BN;

    const workSecret = web3.utils.randomHex(32);
    const workHash = web3.utils.soliditySha3({ type: 'bytes32', value: workSecret }) as string;
    await this.jobRegistry.commitJob(jobId, workHash, { from: worker });
    await this.jobRegistry.revealJob(jobId, workSecret, { from: worker });

    const salt = web3.utils.randomHex(32);
    const commitHash = await this.validation.computeCommitment(jobId, validator, true, salt);
    await this.validation.commitValidation(jobId, commitHash, { from: validator });

    await expectRevert.unspecified(
      this.validation.commitValidation(jobId, commitHash, { from: validator })
    );
  });

  it('blocks finalization while validator commits are pending', async function (this: any) {
    await this.stakeManager.deposit(stakeAmount, { from: worker });
    const createReceipt = await this.jobRegistry.createJob(stakeAmount, { from: client });
    const jobId = createReceipt.logs.find((log: any) => log.event === 'JobCreated').args.jobId as BN;

    const workSecret = web3.utils.randomHex(32);
    const workHash = web3.utils.soliditySha3({ type: 'bytes32', value: workSecret }) as string;
    await this.jobRegistry.commitJob(jobId, workHash, { from: worker });
    await this.jobRegistry.revealJob(jobId, workSecret, { from: worker });

    const salt = web3.utils.randomHex(32);
    const commitHash = await this.validation.computeCommitment(jobId, validator, true, salt);
    await this.validation.commitValidation(jobId, commitHash, { from: validator });

    await expectRevert.unspecified(this.jobRegistry.finalizeJob(jobId, true, { from: deployer }));

    await this.validation.revealValidation(jobId, true, salt, { from: validator });
    const finalizeReceipt = await this.jobRegistry.finalizeJob(jobId, true, { from: deployer });
    expectEvent(finalizeReceipt, 'JobFinalized', { jobId, success: true });
  });

  it('reverts validator reveals with incorrect salts', async function (this: any) {
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

    await expectRevert.unspecified(
      this.validation.revealValidation(jobId, false, web3.utils.randomHex(32), { from: validator })
    );
  });

  it('enforces job commit and reveal windows', async function (this: any) {
    await this.stakeManager.deposit(stakeAmount, { from: worker });
    const createReceipt = await this.jobRegistry.createJob(stakeAmount, { from: client });
    const jobId = createReceipt.logs.find((log: any) => log.event === 'JobCreated').args.jobId as BN;

    const job = await this.jobRegistry.jobs(jobId);
    await time.increaseTo(job.commitDeadline.addn(1));
    await expectRevert.unspecified(
      this.jobRegistry.commitJob(jobId, web3.utils.randomHex(32), { from: worker })
    );
  });

  it('prevents worker reveals after the reveal window expires', async function (this: any) {
    await this.stakeManager.deposit(stakeAmount, { from: worker });
    const createReceipt = await this.jobRegistry.createJob(stakeAmount, { from: client });
    const jobId = createReceipt.logs.find((log: any) => log.event === 'JobCreated').args.jobId as BN;

    const secret = web3.utils.randomHex(32);
    const commitHash = web3.utils.soliditySha3({ type: 'bytes32', value: secret }) as string;
    await this.jobRegistry.commitJob(jobId, commitHash, { from: worker });

    const job = await this.jobRegistry.jobs(jobId);
    await time.increaseTo(job.revealDeadline.addn(1));
    await expectRevert.unspecified(this.jobRegistry.revealJob(jobId, secret, { from: worker }));
  });

  it('allows disputes only once per job', async function (this: any) {
    await this.stakeManager.deposit(stakeAmount, { from: worker });
    const createReceipt = await this.jobRegistry.createJob(stakeAmount, { from: client });
    const jobId = createReceipt.logs.find((log: any) => log.event === 'JobCreated').args.jobId as BN;

    const secret = web3.utils.randomHex(32);
    const commitHash = web3.utils.soliditySha3({ type: 'bytes32', value: secret }) as string;
    await this.jobRegistry.commitJob(jobId, commitHash, { from: worker });
    await this.jobRegistry.revealJob(jobId, secret, { from: worker });

    const disputeReceipt = await this.jobRegistry.raiseDispute(jobId, { from: worker });
    expectEvent(disputeReceipt, 'JobDisputed', { jobId, raiser: worker });

    await expectRevert.unspecified(this.jobRegistry.raiseDispute(jobId, { from: worker }));

    await this.jobRegistry.resolveDispute(jobId, false, 0, 0, { from: deployer });
    await expectRevert.unspecified(this.jobRegistry.resolveDispute(jobId, false, 0, 0, { from: deployer }));
  });
});
