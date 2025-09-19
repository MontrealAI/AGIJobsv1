const { expectEvent, expectRevert, constants, BN } = require('@openzeppelin/test-helpers');
const StakeManager = artifacts.require('StakeManager');
const MockERC20 = artifacts.require('MockERC20');
const ReentrantERC20 = artifacts.require('ReentrantERC20');
const StakeManagerReentrancyAttacker = artifacts.require('StakeManagerReentrancyAttacker');

contract('StakeManager', (accounts) => {
  const [owner, registry, staker, other, feeRecipient] = accounts;
  const initialMint = new BN('1000000');

  beforeEach(async function () {
    this.token = await MockERC20.new('Stake', 'STK', 18, { from: owner });
    await this.token.mint(staker, initialMint, { from: owner });
    this.manager = await StakeManager.new(this.token.address, 18, { from: owner });
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
    await expectRevert(this.manager.deposit('1000', { from: staker }), 'StakeManager: allowance');

    await this.token.approve(this.manager.address, '500', { from: staker });
    await expectRevert(this.manager.deposit('600', { from: staker }), 'StakeManager: allowance');

    await this.token.approve(this.manager.address, '1000', { from: staker });
    const depositReceipt = await this.manager.deposit('1000', { from: staker });
    expectEvent(depositReceipt, 'Deposited', { account: staker, amount: new BN('1000') });
    assert.strictEqual((await this.manager.totalDeposits(staker)).toString(), '1000');
    assert.strictEqual((await this.token.balanceOf(this.manager.address)).toString(), '1000');
    assert.strictEqual(
      (await this.token.balanceOf(staker)).toString(),
      initialMint.sub(new BN('1000')).toString()
    );

    await expectRevert(this.manager.withdraw('0', { from: staker }), 'StakeManager: amount');
    await expectRevert(
      this.manager.withdraw('1500', { from: staker }),
      'StakeManager: insufficient'
    );

    const withdrawReceipt = await this.manager.withdraw('400', { from: staker });
    expectEvent(withdrawReceipt, 'Withdrawn', { account: staker, amount: new BN('400') });
    assert.strictEqual((await this.manager.totalDeposits(staker)).toString(), '600');
    assert.strictEqual((await this.token.balanceOf(this.manager.address)).toString(), '600');
    assert.strictEqual(
      (await this.token.balanceOf(staker)).toString(),
      initialMint.sub(new BN('600')).toString()
    );
  });

  describe('with configured registry', () => {
    beforeEach(async function () {
      await this.manager.setJobRegistry(registry, { from: owner });
      await this.token.approve(this.manager.address, initialMint, { from: staker });
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

      await expectRevert(
        this.manager.settleStake(staker, '0', '50', { from: registry }),
        'StakeManager: fee recipient'
      );
      await this.manager.setFeeRecipient(feeRecipient, { from: owner });

      const releaseOnly = await this.manager.settleStake(staker, '100', '0', { from: registry });
      expectEvent(releaseOnly, 'Released', { amount: web3.utils.toBN(100) });
      expectEvent.notEmitted(releaseOnly, 'Slashed');
      assert.strictEqual((await this.manager.lockedAmounts(staker)).toString(), '600');
      assert.strictEqual((await this.manager.totalDeposits(staker)).toString(), '900');

      const slashOnly = await this.manager.settleStake(staker, '0', '50', { from: registry });
      expectEvent(slashOnly, 'Slashed', { amount: web3.utils.toBN(50) });
      expectEvent.notEmitted(slashOnly, 'Released');
      assert.strictEqual((await this.manager.lockedAmounts(staker)).toString(), '550');
      assert.strictEqual((await this.manager.totalDeposits(staker)).toString(), '850');
      assert.strictEqual((await this.token.balanceOf(feeRecipient)).toString(), '50');

      const receipt = await this.manager.settleStake(staker, '250', '150', { from: registry });
      expectEvent(receipt, 'Released', { amount: web3.utils.toBN(250) });
      expectEvent(receipt, 'Slashed', { amount: web3.utils.toBN(150) });
      assert.strictEqual((await this.manager.lockedAmounts(staker)).toString(), '150');
      assert.strictEqual((await this.manager.totalDeposits(staker)).toString(), '700');
      assert.strictEqual((await this.token.balanceOf(feeRecipient)).toString(), '200');

      await expectRevert(
        this.manager.settleStake(staker, '0', '200', { from: registry }),
        'StakeManager: exceeds locked'
      );

      await expectRevert(
        this.manager.slashStake(staker, '200', { from: registry }),
        'StakeManager: exceeds locked'
      );

      const slash = await this.manager.slashStake(staker, '100', { from: registry });
      expectEvent(slash, 'Slashed', { amount: web3.utils.toBN(100) });
      assert.strictEqual((await this.manager.totalDeposits(staker)).toString(), '600');
      assert.strictEqual((await this.token.balanceOf(feeRecipient)).toString(), '300');
    });

    it('only allows the owner to configure the fee recipient', async function () {
      await expectRevert(
        this.manager.setFeeRecipient(constants.ZERO_ADDRESS, { from: owner }),
        'StakeManager: fee recipient'
      );
      await expectRevert(
        this.manager.setFeeRecipient(feeRecipient, { from: registry }),
        'Ownable: caller is not the owner'
      );

      const receipt = await this.manager.setFeeRecipient(feeRecipient, { from: owner });
      expectEvent(receipt, 'FeeRecipientUpdated', { feeRecipient });
      assert.strictEqual(await this.manager.feeRecipient(), feeRecipient);
    });
  });

  describe('reentrancy protections', () => {
    beforeEach(async function () {
      this.reentrantToken = await ReentrantERC20.new('Stake', 'RSTK', 18, { from: owner });
      this.reentrantManager = await StakeManager.new(this.reentrantToken.address, 18, { from: owner });
      await this.reentrantToken.setReentrantTarget(this.reentrantManager.address, { from: owner });
      this.reentrancyAttacker = await StakeManagerReentrancyAttacker.new(
        this.reentrantManager.address,
        this.reentrantToken.address,
        { from: owner }
      );

      await this.reentrantManager.setJobRegistry(registry, { from: owner });
      await this.reentrantToken.mint(this.reentrancyAttacker.address, '1000', { from: owner });
      await this.reentrancyAttacker.approveAndDeposit('1000', { from: owner });
      await this.reentrantManager.lockStake(this.reentrancyAttacker.address, '800', { from: registry });
    });

    it('prevents reentrant withdrawals from breaking stake accounting', async function () {
      const receipt = await this.reentrancyAttacker.attemptWithdraw('200', '1', { from: owner });
      await expectEvent.inTransaction(receipt.tx, this.reentrantManager, 'Withdrawn', {
        account: this.reentrancyAttacker.address,
        amount: new BN('200'),
      });

      assert.strictEqual(
        (await this.reentrantManager.totalDeposits(this.reentrancyAttacker.address)).toString(),
        '800'
      );
      assert.strictEqual(
        (await this.reentrantManager.lockedAmounts(this.reentrancyAttacker.address)).toString(),
        '800'
      );
      assert.strictEqual(
        (await this.reentrantManager.availableStake(this.reentrancyAttacker.address)).toString(),
        '0'
      );
      assert.strictEqual(
        (await this.reentrantToken.balanceOf(this.reentrancyAttacker.address)).toString(),
        '200'
      );
      assert.isFalse(await this.reentrancyAttacker.reenterCallSucceeded());
    });
  });
});
