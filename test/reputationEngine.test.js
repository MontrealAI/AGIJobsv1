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

    await this.engine.setJobRegistry(registry, { from: owner });
    assert.strictEqual(await this.engine.jobRegistry(), registry);
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
});
