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
      'DisputeModule: registry already set'
    );
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
});
