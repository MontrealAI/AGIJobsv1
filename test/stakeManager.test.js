const { expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const StakeManager = artifacts.require('StakeManager');
const FeePool = artifacts.require('FeePool');
const MockERC20 = artifacts.require('MockERC20');

contract('StakeManager', (accounts) => {
  const [owner, registry, staker, other, burnAddress] = accounts;

  beforeEach(async function () {
    this.token = await MockERC20.new('Mock Stake', 'MST', 18);
    this.manager = await StakeManager.new(this.token.address, 18, { from: owner });
    this.feePool = await FeePool.new(this.token.address, burnAddress, { from: owner });
    await this.manager.setJobRegistry(registry, { from: owner });
    await this.manager.setFeePool(this.feePool.address, { from: owner });
    await this.feePool.setJobRegistry(registry, { from: owner });
    await this.feePool.setStakeManager(this.manager.address, { from: owner });
    await this.token.mint(staker, web3.utils.toBN('1000000'));
  });

  it('requires a non-zero staking token', async function () {
    await expectRevert(
      StakeManager.new(constants.ZERO_ADDRESS, 18, { from: owner }),
      'StakeManager: token'
    );
  });

  it('allows owner to set the job registry', async function () {
    await expectRevert(
      this.manager.setJobRegistry(constants.ZERO_ADDRESS, { from: owner }),
      'StakeManager: zero registry'
    );
    await expectRevert(
      this.manager.setJobRegistry(registry, { from: registry }),
      'Ownable: caller is not the owner'
    );

    const receipt = await this.manager.setJobRegistry(registry, { from: owner });
    expectEvent(receipt, 'JobRegistryUpdated', { jobRegistry: registry });
    assert.strictEqual(await this.manager.jobRegistry(), registry);
  });

  it('handles deposits and withdrawals with proper checks', async function () {
    await expectRevert(this.manager.deposit('0', { from: staker }), 'StakeManager: amount');
    await expectRevert(
      this.manager.deposit('1000', { from: staker }),
      'ERC20: insufficient allowance'
    );

    await this.token.approve(this.manager.address, '1000', { from: staker });
    const stakerBeforeDeposit = await this.token.balanceOf(staker);
    await this.manager.deposit('1000', { from: staker });
    const stakerAfterDeposit = await this.token.balanceOf(staker);
    const managerAfterDeposit = await this.token.balanceOf(this.manager.address);
    assert.strictEqual((await this.manager.totalDeposits(staker)).toString(), '1000');
    assert.strictEqual(stakerBeforeDeposit.sub(stakerAfterDeposit).toString(), '1000');
    assert.strictEqual(managerAfterDeposit.toString(), '1000');

    await expectRevert(this.manager.withdraw('0', { from: staker }), 'StakeManager: amount');
    await expectRevert(
      this.manager.withdraw('1500', { from: staker }),
      'StakeManager: insufficient'
    );

    const stakerBeforeWithdraw = await this.token.balanceOf(staker);
    const managerBeforeWithdraw = await this.token.balanceOf(this.manager.address);
    await this.manager.withdraw('400', { from: staker });
    const stakerAfterWithdraw = await this.token.balanceOf(staker);
    const managerAfterWithdraw = await this.token.balanceOf(this.manager.address);
    assert.strictEqual((await this.manager.totalDeposits(staker)).toString(), '600');
    assert.strictEqual(stakerAfterWithdraw.sub(stakerBeforeWithdraw).toString(), '400');
    assert.strictEqual(managerBeforeWithdraw.sub(managerAfterWithdraw).toString(), '400');
  });

  describe('with configured registry', () => {
    beforeEach(async function () {
      await this.token.approve(this.manager.address, constants.MAX_UINT256, { from: staker });
    });

    it('enforces registry permissions', async function () {
      await this.manager.deposit('500', { from: staker });
      await expectRevert(
        this.manager.lockStake(staker, '200', { from: other }),
        'StakeManager: not registry'
      );
      await expectRevert(
        this.manager.lockStake(staker, '0', { from: registry }),
        'StakeManager: amount'
      );

      await expectRevert(
        this.manager.lockStake(staker, '600', { from: registry }),
        'StakeManager: insufficient'
      );

      await this.manager.lockStake(staker, '200', { from: registry });
      expectEvent(await this.manager.releaseStake(staker, '50', { from: registry }), 'Released', {
        account: staker,
        amount: web3.utils.toBN(50),
      });
      assert.strictEqual((await this.manager.lockedAmounts(staker)).toString(), '150');
      assert.strictEqual((await this.manager.availableStake(staker)).toString(), '350');

      await expectRevert(
        this.manager.releaseStake(staker, '500', { from: registry }),
        'StakeManager: exceeds locked'
      );
    });

    it('supports settling and slashing locked stake', async function () {
      await this.manager.deposit('900', { from: staker });
      await this.manager.lockStake(staker, '700', { from: registry });

      await expectRevert(
        this.manager.settleStake(staker, '0', '0', { from: registry }),
        'StakeManager: nothing to settle'
      );
      await expectRevert(
        this.manager.settleStake(staker, '800', '0', { from: registry }),
        'StakeManager: exceeds locked'
      );

      const stakerBalanceBefore = await this.token.balanceOf(staker);
      const burnBefore = await this.token.balanceOf(burnAddress);

      const releaseOnly = await this.manager.settleStake(staker, '100', '0', { from: registry });
      expectEvent(releaseOnly, 'Released', { amount: web3.utils.toBN(100) });
      expectEvent.notEmitted(releaseOnly, 'Slashed');
      assert.strictEqual((await this.manager.lockedAmounts(staker)).toString(), '600');
      assert.strictEqual((await this.manager.totalDeposits(staker)).toString(), '800');
      const stakerAfterRelease = await this.token.balanceOf(staker);
      assert.strictEqual(stakerAfterRelease.sub(stakerBalanceBefore).toString(), '100');

      const releaseBalanceBefore = await this.token.balanceOf(staker);

      const slashOnly = await this.manager.settleStake(staker, '0', '50', { from: registry });
      expectEvent(slashOnly, 'Slashed', { amount: web3.utils.toBN(50) });
      expectEvent.notEmitted(slashOnly, 'Released');
      assert.strictEqual((await this.manager.lockedAmounts(staker)).toString(), '550');
      assert.strictEqual((await this.manager.totalDeposits(staker)).toString(), '750');
      const burnAfterSlash = await this.token.balanceOf(burnAddress);
      assert.strictEqual(burnAfterSlash.sub(burnBefore).toString(), '50');

      const receipt = await this.manager.settleStake(staker, '250', '150', { from: registry });
      expectEvent(receipt, 'Released', { amount: web3.utils.toBN(250) });
      expectEvent(receipt, 'Slashed', { amount: web3.utils.toBN(150) });
      assert.strictEqual((await this.manager.lockedAmounts(staker)).toString(), '150');
      assert.strictEqual((await this.manager.totalDeposits(staker)).toString(), '350');
      const stakerAfterFinalRelease = await this.token.balanceOf(staker);
      assert.strictEqual(
        stakerAfterFinalRelease.sub(releaseBalanceBefore).toString(),
        '250'
      );
      const burnAfterFinalSlash = await this.token.balanceOf(burnAddress);
      assert.strictEqual(burnAfterFinalSlash.sub(burnAfterSlash).toString(), '150');

      await expectRevert(
        this.manager.settleStake(staker, '0', '200', { from: registry }),
        'StakeManager: exceeds locked'
      );

      await expectRevert(
        this.manager.slashStake(staker, '200', { from: registry }),
        'StakeManager: exceeds locked'
      );

      const slashBurnBefore = await this.token.balanceOf(burnAddress);
      const slash = await this.manager.slashStake(staker, '100', { from: registry });
      expectEvent(slash, 'Slashed', { amount: web3.utils.toBN(100) });
      assert.strictEqual((await this.manager.totalDeposits(staker)).toString(), '250');
      const slashBurnAfter = await this.token.balanceOf(burnAddress);
      assert.strictEqual(slashBurnAfter.sub(slashBurnBefore).toString(), '100');
    });
  });
});
