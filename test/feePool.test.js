const { expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const FeePool = artifacts.require('FeePool');
const MockERC20 = artifacts.require('MockERC20');

contract('FeePool', (accounts) => {
  const [owner, registry, stranger, burnAddress] = accounts;

  beforeEach(async function () {
    this.token = await MockERC20.new('Stake', 'STK', 18, { from: owner });
    await this.token.mint(owner, web3.utils.toBN('1000'), { from: owner });
    this.pool = await FeePool.new(this.token.address, burnAddress, { from: owner });
  });

  it('sets the job registry with owner checks', async function () {
    await expectRevert(this.pool.setJobRegistry(constants.ZERO_ADDRESS, { from: owner }), 'FeePool: registry');
    await expectRevert(this.pool.setJobRegistry(registry, { from: registry }), 'Ownable: caller is not the owner');

    const receipt = await this.pool.setJobRegistry(registry, { from: owner });
    expectEvent(receipt, 'JobRegistryUpdated', { jobRegistry: registry });
    assert.strictEqual(await this.pool.jobRegistry(), registry);
  });

  it('requires non-zero constructor arguments', async function () {
    await expectRevert(FeePool.new(constants.ZERO_ADDRESS, burnAddress, { from: owner }), 'FeePool: token');
    await expectRevert(FeePool.new(this.token.address, constants.ZERO_ADDRESS, { from: owner }), 'FeePool: burn');
  });

  it('enforces ownership transfers', async function () {
    await expectRevert(this.pool.transferOwnership(constants.ZERO_ADDRESS, { from: owner }), 'Ownable: zero address');
    await expectRevert(this.pool.transferOwnership(stranger, { from: stranger }), 'Ownable: caller is not the owner');

    const tx = await this.pool.transferOwnership(stranger, { from: owner });
    expectEvent(tx, 'OwnershipTransferred', { newOwner: stranger });
    assert.strictEqual(await this.pool.owner(), stranger);
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

  it('burns accumulated fees to the configured sink', async function () {
    await expectRevert(this.pool.burnAccumulatedFees({ from: stranger }), 'Ownable: caller is not the owner');
    await expectRevert(this.pool.burnAccumulatedFees({ from: owner }), 'FeePool: nothing to burn');

    await this.token.transfer(this.pool.address, '200', { from: owner });
    const receipt = await this.pool.burnAccumulatedFees({ from: owner });
    expectEvent(receipt, 'FeesBurned', { amount: web3.utils.toBN(200) });
    assert.strictEqual((await this.token.balanceOf(burnAddress)).toString(), '200');
  });
});
