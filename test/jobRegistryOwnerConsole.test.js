const { expect } = require('chai');
const { time } = require('@openzeppelin/test-helpers');

const IdentityRegistry = artifacts.require('IdentityRegistry');
const StakeManager = artifacts.require('StakeManager');
const FeePool = artifacts.require('FeePool');
const ValidationModule = artifacts.require('ValidationModule');
const DisputeModule = artifacts.require('DisputeModule');
const ReputationEngine = artifacts.require('ReputationEngine');
const JobRegistry = artifacts.require('JobRegistry');
const MockERC20 = artifacts.require('MockERC20');

const {
  parseOwnerConsoleArgs,
  collectOwnerStatus,
  buildOwnerTxPlan,
  JOB_STATE_NAMES,
} = require('../scripts/lib/job-registry-owner');

async function expectAsyncError(promise, message) {
  try {
    await promise;
    expect.fail('Expected promise to be rejected');
  } catch (error) {
    expect(error.message).to.include(message);
  }
}

contract('JobRegistry owner console helpers', (accounts) => {
  const [deployer, worker, client, burnAddress] = accounts;
  const stakeAmount = web3.utils.toBN('500');
  const initialStake = web3.utils.toBN('1000000');

  beforeEach(async function () {
    this.identity = await IdentityRegistry.new({ from: deployer });
    this.token = await MockERC20.new('Stake', 'STK', 18, worker, initialStake, { from: deployer });
    this.stakeManager = await StakeManager.new(this.token.address, 18, { from: deployer });
    this.feePool = await FeePool.new(this.token.address, burnAddress, { from: deployer });
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
    await this.validation.setJobRegistry(this.jobRegistry.address, { from: deployer });
    await this.stakeManager.setJobRegistry(this.jobRegistry.address, { from: deployer });
    await this.stakeManager.setFeeRecipient(this.feePool.address, { from: deployer });
    await this.feePool.setJobRegistry(this.jobRegistry.address, { from: deployer });
    await this.dispute.setJobRegistry(this.jobRegistry.address, { from: deployer });
    await this.reputation.setJobRegistry(this.jobRegistry.address, { from: deployer });
    await this.jobRegistry.setTimings(3600, 3600, 7200, { from: deployer });
    await this.jobRegistry.setThresholds(6000, 1, 11, 250, 2000, { from: deployer });

    await this.token.approve(this.stakeManager.address, initialStake, { from: worker });
    await this.stakeManager.deposit(initialStake, { from: worker });
  });

  function randomSecret() {
    return web3.utils.randomHex(32);
  }

  async function createJobLifecycle(context) {
    const { jobRegistry } = context;
    const { logs } = await jobRegistry.createJob(stakeAmount, { from: client });
    const jobId = logs.find((log) => log.event === 'JobCreated').args.jobId;
    return jobId;
  }

  async function commitJob(context, jobId) {
    const secret = randomSecret();
    const hash = web3.utils.soliditySha3({ type: 'bytes32', value: secret });
    await context.jobRegistry.commitJob(jobId, hash, { from: worker });
    return secret;
  }

  it('parses owner console arguments and positional action', () => {
    const argv = [
      'node',
      'script.js',
      '--from',
      '0x1234567890123456789012345678901234567890',
      '--execute=false',
      '--job',
      '7',
      '--slash-worker',
      '--reputation-delta',
      '-3',
      'resolve',
    ];

    const parsed = parseOwnerConsoleArgs(argv);
    expect(parsed.action).to.equal('resolve');
    expect(parsed.from).to.equal('0x1234567890123456789012345678901234567890');
    expect(parsed.execute).to.be.false;
    expect(parsed.jobId).to.equal('7');
    expect(parsed.slashWorker).to.be.true;
    expect(parsed.reputationDelta).to.equal('-3');
  });

  it('collects status with job summary', async function () {
    const jobId = await createJobLifecycle(this);
    const status = await collectOwnerStatus({
      registry: this.jobRegistry,
      web3,
      owner: deployer,
      jobId: jobId.toString(),
    });

    expect(status.owner).to.equal(deployer);
    expect(status.configuration.modules).to.be.true;
    expect(status.job.id).to.equal(jobId.toString());
    expect(status.job.state.name).to.equal(JOB_STATE_NAMES[1]);
  });

  it('builds an extend plan and updates deadlines', async function () {
    const jobId = await createJobLifecycle(this);
    const plan = await buildOwnerTxPlan({
      registry: this.jobRegistry,
      web3,
      options: {
        action: 'extend',
        jobId: jobId.toString(),
        commitExtension: '900',
        revealExtension: '0',
        disputeExtension: '0',
      },
    });

    expect(plan.method).to.equal('extendJobDeadlines');
    expect(plan.args[1]).to.equal('900');

    const before = await this.jobRegistry.jobs(jobId);
    const initialCommitDeadline = before.commitDeadline;

    await this.jobRegistry.extendJobDeadlines(jobId, 900, 0, 0, { from: deployer });
    const after = await this.jobRegistry.jobs(jobId);
    expect(after.commitDeadline.sub(initialCommitDeadline).toString()).to.equal('900');
  });

  it('builds a finalize plan and reports fee amount', async function () {
    const jobId = await createJobLifecycle(this);
    const secret = await commitJob(this, jobId);
    await this.jobRegistry.revealJob(jobId, secret, { from: worker });

    const plan = await buildOwnerTxPlan({
      registry: this.jobRegistry,
      web3,
      options: {
        action: 'finalize',
        jobId: jobId.toString(),
        success: false,
      },
    });

    expect(plan.method).to.equal('finalizeJob');
    expect(plan.metadata.feeAmount.toString()).to.equal(
      stakeAmount.muln(250).divn(10000).toString()
    );

    await this.jobRegistry.finalizeJob(jobId, false, { from: deployer });
    const job = await this.jobRegistry.jobs(jobId);
    expect(job.state.toNumber()).to.equal(4);
  });

  it('builds a resolve plan with slashing', async function () {
    const jobId = await createJobLifecycle(this);
    const secret = await commitJob(this, jobId);
    await this.jobRegistry.revealJob(jobId, secret, { from: worker });
    await this.jobRegistry.raiseDispute(jobId, { from: client });

    const plan = await buildOwnerTxPlan({
      registry: this.jobRegistry,
      web3,
      options: {
        action: 'resolve',
        jobId: jobId.toString(),
        slashWorker: true,
        slashAmount: '80',
        reputationDelta: '-1',
      },
    });

    expect(plan.method).to.equal('resolveDispute');
    expect(plan.metadata.slashAmount.toString()).to.equal('80');

    await this.jobRegistry.resolveDispute(jobId, true, 80, '-1', { from: deployer });
    const job = await this.jobRegistry.jobs(jobId);
    expect(job.state.toNumber()).to.equal(4);
  });

  it('builds a timeout plan and enforces slash ceilings', async function () {
    const jobId = await createJobLifecycle(this);
    await commitJob(this, jobId);

    const plan = await buildOwnerTxPlan({
      registry: this.jobRegistry,
      web3,
      options: {
        action: 'timeout',
        jobId: jobId.toString(),
        slashAmount: '10',
      },
    });

    expect(plan.method).to.equal('timeoutJob');

    const job = await this.jobRegistry.jobs(jobId);
    const disputeDeadline = job.disputeDeadline.addn(1);
    await time.increaseTo(disputeDeadline);
    await this.jobRegistry.timeoutJob(jobId, 10, { from: deployer });
    const updated = await this.jobRegistry.jobs(jobId);
    expect(updated.state.toNumber()).to.equal(4);
  });

  it('rejects extend plan when all extensions are zero', async function () {
    const jobId = await createJobLifecycle(this);
    await expectAsyncError(
      buildOwnerTxPlan({
        registry: this.jobRegistry,
        web3,
        options: {
          action: 'extend',
          jobId: jobId.toString(),
          commitExtension: '0',
          revealExtension: '0',
          disputeExtension: '0',
        },
      }),
      'At least one extension value must be greater than zero'
    );
  });

  it('rejects resolve plan with slash exceeding limits', async function () {
    const jobId = await createJobLifecycle(this);
    const secret = await commitJob(this, jobId);
    await this.jobRegistry.revealJob(jobId, secret, { from: worker });
    await this.jobRegistry.raiseDispute(jobId, { from: client });

    await expectAsyncError(
      buildOwnerTxPlan({
        registry: this.jobRegistry,
        web3,
        options: {
          action: 'resolve',
          jobId: jobId.toString(),
          slashWorker: true,
          slashAmount: stakeAmount.muln(3).toString(),
        },
      }),
      'slashAmount must not exceed the job stake amount'
    );
  });
});
