const { expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const StakeManager = artifacts.require('StakeManager');
const FeePool = artifacts.require('FeePool');
const MockERC20 = artifacts.require('MockERC20');

contract('StakeManager', (accounts) => {
  const [owner, registry, staker, other, burn] = accounts;
  const toBN = web3.utils.toBN;

  beforeEach(async function () {
    this.token = await MockERC20.new('Stake Token', 'STK', 18, { from: owner });
    this.manager = await StakeManager.new(this.token.address, 18, { from: owner });
    this.feePool = await FeePool.new(this.token.address, burn, { from: owner });

    await this.manager.setFeePool(this.feePool.address, { from: owner });
    await this.feePool.setStakeManager(this.manager.address, { from: owner });

    await this.token.mint(staker, toBN('1000'), { from: owner });
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

  it('handles deposits and withdrawals with token transfers and allowance checks', async function () {
    await expectRevert(this.manager.deposit('0', { from: staker }), 'StakeManager: amount');
    await expectRevert(this.manager.deposit('100', { from: staker }), 'StakeManager: allowance');

    await this.token.approve(this.manager.address, toBN('1000'), { from: staker });
    const receipt = await this.manager.deposit('1000', { from: staker });
    expectEvent(receipt, 'Deposited', { account: staker, amount: toBN(1000) });

    assert.strictEqual((await this.manager.totalDeposits(staker)).toString(), '1000');
    assert.strictEqual((await this.token.balanceOf(this.manager.address)).toString(), '1000');

    await expectRevert(this.manager.withdraw('0', { from: staker }), 'StakeManager: amount');
    await expectRevert(this.manager.withdraw('1500', { from: staker }), 'StakeManager: insufficient');

    const withdrawReceipt = await this.manager.withdraw('400', { from: staker });
    expectEvent(withdrawReceipt, 'Withdrawn', { account: staker, amount: toBN(400) });
    assert.strictEqual((await this.manager.totalDeposits(staker)).toString(), '600');
    assert.strictEqual((await this.token.balanceOf(this.manager.address)).toString(), '600');
    assert.strictEqual((await this.token.balanceOf(staker)).toString(), '400');
  });

  describe('with configured registry', () => {
    beforeEach(async function () {
      await this.manager.setJobRegistry(registry, { from: owner });
      await this.token.approve(this.manager.address, toBN('1000'), { from: staker });
      await this.manager.deposit('600', { from: staker });
    });

    it('enforces registry permissions', async function () {
      await expectRevert(
        this.manager.lockStake(staker, '200', { from: other }),
        'StakeManager: not registry'
      );
      await expectRevert(this.manager.lockStake(staker, '0', { from: registry }), 'StakeManager: amount');

      await this.manager.lockStake(staker, '200', { from: registry });
      expectEvent(await this.manager.releaseStake(staker, '50', { from: registry }), 'Released', {
        account: staker,
        amount: toBN(50)
      });
      assert.strictEqual((await this.manager.lockedAmounts(staker)).toString(), '150');
      assert.strictEqual((await this.manager.availableStake(staker)).toString(), '450');

      await expectRevert(
        this.manager.releaseStake(staker, '500', { from: registry }),
        'StakeManager: exceeds locked'
      );
    });

    it('supports settling and slashing locked stake with fee forwarding', async function () {
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
      expectEvent(receipt, 'Released', { amount: toBN(250) });
      expectEvent(receipt, 'Slashed', { amount: toBN(100) });
      assert.strictEqual((await this.manager.lockedAmounts(staker)).toString(), '50');
      assert.strictEqual((await this.manager.totalDeposits(staker)).toString(), '500');
      assert.strictEqual((await this.token.balanceOf(this.manager.address)).toString(), '500');
      assert.strictEqual((await this.token.balanceOf(burn)).toString(), '100');

      await expectRevert(
        this.manager.slashStake(staker, '100', { from: registry }),
        'StakeManager: exceeds locked'
      );

      const slash = await this.manager.slashStake(staker, '50', { from: registry });
      expectEvent(slash, 'Slashed', { amount: toBN(50) });
      assert.strictEqual((await this.manager.totalDeposits(staker)).toString(), '450');
      assert.strictEqual((await this.token.balanceOf(this.manager.address)).toString(), '450');
      assert.strictEqual((await this.token.balanceOf(burn)).toString(), '150');
    });
  });
});
