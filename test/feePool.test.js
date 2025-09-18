const { expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const FeePool = artifacts.require('FeePool');

contract('FeePool', (accounts) => {
  const [owner, registry, stranger] = accounts;

  beforeEach(async function () {
    this.pool = await FeePool.new(constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, { from: owner });
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
});
