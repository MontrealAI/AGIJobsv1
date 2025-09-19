const { expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const FeePool = artifacts.require('FeePool');
const MockERC20 = artifacts.require('MockERC20');

contract('FeePool', (accounts) => {
  const [owner, registry, stranger, burn, staking] = accounts;

  beforeEach(async function () {
    this.token = await MockERC20.new('Stake Token', 'STK', 18, { from: owner });
    this.pool = await FeePool.new(this.token.address, burn, { from: owner });
  });

  it('sets the job registry with owner checks', async function () {
    await expectRevert(this.pool.setJobRegistry(constants.ZERO_ADDRESS, { from: owner }), 'FeePool: registry');
    await expectRevert(this.pool.setJobRegistry(registry, { from: registry }), 'Ownable: caller is not the owner');

    await this.pool.setJobRegistry(registry, { from: owner });
    assert.strictEqual(await this.pool.jobRegistry(), registry);
  });

  it('records fees from the owner and registry and rejects invalid calls', async function () {
    const ownerReceipt = await this.pool.recordFee('50', { from: owner });
    expectEvent(ownerReceipt, 'FeeRecorded', { amount: web3.utils.toBN(50) });
    assert.strictEqual((await this.pool.totalFeesRecorded()).toString(), '50');

    await expectRevert(this.pool.recordFee('0', { from: owner }), 'FeePool: amount');
    await this.pool.setJobRegistry(registry, { from: owner });

    const registryReceipt = await this.pool.recordFee('25', { from: registry });
    expectEvent(registryReceipt, 'FeeRecorded', { amount: web3.utils.toBN(25) });
    assert.strictEqual((await this.pool.totalFeesRecorded()).toString(), '75');

    await expectRevert(this.pool.recordFee('10', { from: stranger }), 'FeePool: not authorized');
  });

  it('forwards slashed stake to the burn address from the stake manager', async function () {
    await expectRevert(this.pool.setStakeManager(constants.ZERO_ADDRESS, { from: owner }), 'FeePool: stake manager');
    await expectRevert(this.pool.setStakeManager(staking, { from: stranger }), 'Ownable: caller is not the owner');

    await this.pool.setStakeManager(staking, { from: owner });
    await this.token.mint(this.pool.address, web3.utils.toBN('100'), { from: owner });

    await expectRevert(this.pool.forwardToBurn('50', { from: owner }), 'FeePool: not staking');
    await expectRevert(this.pool.forwardToBurn('0', { from: staking }), 'FeePool: amount');

    const receipt = await this.pool.forwardToBurn('50', { from: staking });
    expectEvent(receipt, 'FeeRecorded', { amount: web3.utils.toBN(50) });
    assert.strictEqual((await this.pool.totalFeesRecorded()).toString(), '50');
    assert.strictEqual((await this.token.balanceOf(burn)).toString(), '50');
  });
});
