const { expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const DisputeModule = artifacts.require('DisputeModule');

contract('DisputeModule', (accounts) => {
  const [owner, registry, raiser] = accounts;

  beforeEach(async function () {
    this.module = await DisputeModule.new({ from: owner });
  });

  it('configures the job registry with ownership checks', async function () {
    await expectRevert(
      this.module.setJobRegistry(constants.ZERO_ADDRESS, { from: owner }),
      'DisputeModule: registry'
    );

    await expectRevert(
      this.module.setJobRegistry(registry, { from: registry }),
      'Ownable: caller is not the owner'
    );

    const receipt = await this.module.setJobRegistry(registry, { from: owner });
    expectEvent(receipt, 'JobRegistryUpdated', { jobRegistry: registry });
    assert.strictEqual(await this.module.jobRegistry(), registry);

    await expectRevert(
      this.module.setJobRegistry(raiser, { from: owner }),
      'DisputeModule: registry set'
    );
  });

  it('lets the owner rotate the registry assignment during a pause', async function () {
    await expectRevert(
      this.module.updateJobRegistry(registry, { from: owner }),
      'Pausable: not paused'
    );

    await this.module.pause({ from: owner });
    await expectRevert(
      this.module.updateJobRegistry(registry, { from: owner }),
      'DisputeModule: registry unset'
    );
    await this.module.unpause({ from: owner });

    await this.module.setJobRegistry(registry, { from: owner });

    await expectRevert(
      this.module.updateJobRegistry(raiser, { from: raiser }),
      'Ownable: caller is not the owner'
    );

    await expectRevert(
      this.module.updateJobRegistry(raiser, { from: owner }),
      'Pausable: not paused'
    );

    await this.module.pause({ from: owner });

    await expectRevert(
      this.module.updateJobRegistry(constants.ZERO_ADDRESS, { from: owner }),
      'DisputeModule: registry'
    );

    await expectRevert(
      this.module.updateJobRegistry(registry, { from: owner }),
      'DisputeModule: registry unchanged'
    );

    const receipt = await this.module.updateJobRegistry(raiser, { from: owner });
    expectEvent(receipt, 'JobRegistryUpdated', { jobRegistry: raiser });
    assert.strictEqual(await this.module.jobRegistry(), raiser);

    await this.module.unpause({ from: owner });
  });

  it('emits events only when called by the registry', async function () {
    await this.module.setJobRegistry(registry, { from: owner });

    await expectRevert(this.module.onDisputeRaised(1, raiser, { from: owner }), 'DisputeModule: not registry');
    await expectRevert(this.module.onDisputeResolved(1, true, { from: owner }), 'DisputeModule: not registry');

    const raised = await this.module.onDisputeRaised(1, raiser, { from: registry });
    expectEvent(raised, 'DisputeRaised', { jobId: web3.utils.toBN(1), raiser });

    const resolved = await this.module.onDisputeResolved(1, true, { from: registry });
    expectEvent(resolved, 'DisputeResolved', { jobId: web3.utils.toBN(1), slashWorker: true });
  });

  it('respects the paused state for registry callbacks', async function () {
    await this.module.setJobRegistry(registry, { from: owner });

    await expectRevert(this.module.pause({ from: registry }), 'Ownable: caller is not the owner');

    const pauseReceipt = await this.module.pause({ from: owner });
    expectEvent(pauseReceipt, 'Paused', { account: owner });
    assert.isTrue(await this.module.paused());

    await expectRevert(
      this.module.onDisputeRaised(2, raiser, { from: registry }),
      'Pausable: paused'
    );
    await expectRevert(
      this.module.onDisputeResolved(2, true, { from: registry }),
      'Pausable: paused'
    );

    const unpauseReceipt = await this.module.unpause({ from: owner });
    expectEvent(unpauseReceipt, 'Unpaused', { account: owner });
    assert.isFalse(await this.module.paused());

    const raised = await this.module.onDisputeRaised(3, raiser, { from: registry });
    expectEvent(raised, 'DisputeRaised', { jobId: web3.utils.toBN(3), raiser });

    const resolved = await this.module.onDisputeResolved(3, false, { from: registry });
    expectEvent(resolved, 'DisputeResolved', { jobId: web3.utils.toBN(3), slashWorker: false });
  });
});
