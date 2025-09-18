const { expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const StakeManager = artifacts.require('StakeManager');

contract('StakeManager', (accounts) => {
  const [owner, registry, staker, other] = accounts;

  beforeEach(async function () {
    this.manager = await StakeManager.new(constants.ZERO_ADDRESS, 18, { from: owner });
  });

  it('allows owner to set the job registry', async function () {
    await expectRevert(
      this.manager.setJobRegistry(constants.ZERO_ADDRESS, { from: owner }),
      'StakeManager: zero registry'
    );
    await expectRevert(this.manager.setJobRegistry(registry, { from: registry }), 'Ownable: caller is not the owner');

    const receipt = await this.manager.setJobRegistry(registry, { from: owner });
    expectEvent(receipt, 'JobRegistryUpdated', { jobRegistry: registry });
    assert.strictEqual(await this.manager.jobRegistry(), registry);
  });

  it('handles deposits and withdrawals with proper checks', async function () {
    await expectRevert(this.manager.deposit('0', { from: staker }), 'StakeManager: amount');
    await this.manager.deposit('1000', { from: staker });
    assert.strictEqual((await this.manager.totalDeposits(staker)).toString(), '1000');

    await expectRevert(this.manager.withdraw('0', { from: staker }), 'StakeManager: amount');
    await expectRevert(this.manager.withdraw('1500', { from: staker }), 'StakeManager: insufficient');

    await this.manager.withdraw('400', { from: staker });
    assert.strictEqual((await this.manager.totalDeposits(staker)).toString(), '600');
  });

  describe('with configured registry', () => {
    beforeEach(async function () {
      await this.manager.setJobRegistry(registry, { from: owner });
    });

    it('enforces registry permissions', async function () {
      await this.manager.deposit('500', { from: staker });
      await expectRevert(
        this.manager.lockStake(staker, '200', { from: other }),
        'StakeManager: not registry'
      );
      await expectRevert(this.manager.lockStake(staker, '0', { from: registry }), 'StakeManager: amount');

      await this.manager.lockStake(staker, '200', { from: registry });
      expectEvent(await this.manager.releaseStake(staker, '50', { from: registry }), 'Released', {
        account: staker,
        amount: web3.utils.toBN(50)
      });
      assert.strictEqual((await this.manager.lockedAmounts(staker)).toString(), '150');
      assert.strictEqual((await this.manager.availableStake(staker)).toString(), '350');

      await expectRevert(
        this.manager.releaseStake(staker, '500', { from: registry }),
        'StakeManager: exceeds locked'
      );
    });

    it('supports settling and slashing locked stake', async function () {
      await this.manager.deposit('600', { from: staker });
      await this.manager.lockStake(staker, '400', { from: registry });

      await expectRevert(
        this.manager.settleStake(staker, '0', '0', { from: registry }),
        'StakeManager: nothing to settle'
      );
      await expectRevert(
        this.manager.settleStake(staker, '500', '0', { from: registry }),
        'StakeManager: exceeds locked'
      );

      const receipt = await this.manager.settleStake(staker, '250', '100', { from: registry });
      expectEvent(receipt, 'Released', { amount: web3.utils.toBN(250) });
      expectEvent(receipt, 'Slashed', { amount: web3.utils.toBN(100) });
      assert.strictEqual((await this.manager.lockedAmounts(staker)).toString(), '50');
      assert.strictEqual((await this.manager.totalDeposits(staker)).toString(), '500');

      await expectRevert(
        this.manager.slashStake(staker, '100', { from: registry }),
        'StakeManager: exceeds locked'
      );

      const slash = await this.manager.slashStake(staker, '50', { from: registry });
      expectEvent(slash, 'Slashed', { amount: web3.utils.toBN(50) });
      assert.strictEqual((await this.manager.totalDeposits(staker)).toString(), '450');
    });
  });
});
