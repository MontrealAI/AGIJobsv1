const { expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const ReputationEngine = artifacts.require('ReputationEngine');

contract('ReputationEngine', (accounts) => {
  const [owner, registry, worker] = accounts;

  beforeEach(async function () {
    this.engine = await ReputationEngine.new({ from: owner });
  });

  it('sets the job registry and enforces ownership', async function () {
    await expectRevert(
      this.engine.setJobRegistry(constants.ZERO_ADDRESS, { from: owner }),
      'ReputationEngine: registry'
    );

    await expectRevert(
      this.engine.setJobRegistry(registry, { from: registry }),
      'Ownable: caller is not the owner'
    );

    const receipt = await this.engine.setJobRegistry(registry, { from: owner });
    expectEvent(receipt, 'JobRegistryUpdated', { jobRegistry: registry });
    assert.strictEqual(await this.engine.jobRegistry(), registry);

    await expectRevert(
      this.engine.setJobRegistry(worker, { from: owner }),
      'ReputationEngine: registry set'
    );
  });

  it('adjusts reputation only when called by registry', async function () {
    await expectRevert(
      this.engine.adjustReputation(worker, 1, { from: owner }),
      'ReputationEngine: not registry'
    );

    await this.engine.setJobRegistry(registry, { from: owner });
    const increase = await this.engine.adjustReputation(worker, 5, { from: registry });
    expectEvent(increase, 'ReputationUpdated', { worker, delta: web3.utils.toBN(5) });
    assert.strictEqual((await this.engine.reputation(worker)).toString(), '5');

    const decrease = await this.engine.adjustReputation(worker, -3, { from: registry });
    expectEvent(decrease, 'ReputationUpdated', { delta: web3.utils.toBN(-3) });
    assert.strictEqual((await this.engine.reputation(worker)).toString(), '2');
  });

  it('blocks reputation changes while paused and resumes after unpausing', async function () {
    await this.engine.setJobRegistry(registry, { from: owner });

    await expectRevert(this.engine.pause({ from: registry }), 'Ownable: caller is not the owner');

    const pauseReceipt = await this.engine.pause({ from: owner });
    expectEvent(pauseReceipt, 'Paused', { account: owner });
    assert.isTrue(await this.engine.paused());

    await expectRevert(this.engine.adjustReputation(worker, 1, { from: registry }), 'Pausable: paused');

    const unpauseReceipt = await this.engine.unpause({ from: owner });
    expectEvent(unpauseReceipt, 'Unpaused', { account: owner });
    assert.isFalse(await this.engine.paused());

    const receipt = await this.engine.adjustReputation(worker, 4, { from: registry });
    expectEvent(receipt, 'ReputationUpdated', { worker, delta: web3.utils.toBN(4) });
    assert.strictEqual((await this.engine.reputation(worker)).toString(), '4');
  });
});
