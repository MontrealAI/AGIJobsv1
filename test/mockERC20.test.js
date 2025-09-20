const { expectEvent, expectRevert, constants, BN } = require('@openzeppelin/test-helpers');
const MockERC20 = artifacts.require('MockERC20');

contract('MockERC20', (accounts) => {
  const [deployer, holder, spender, recipient] = accounts;
  const initialSupply = new BN('1000000');

  beforeEach(async function () {
    this.token = await MockERC20.new('Mock Token', 'MOCK', 18, holder, initialSupply, { from: deployer });
  });

  it('initializes metadata and mints to the initial holder', async function () {
    assert.strictEqual(await this.token.name(), 'Mock Token');
    assert.strictEqual(await this.token.symbol(), 'MOCK');
    assert.strictEqual((await this.token.decimals()).toString(), '18');
    assert.strictEqual((await this.token.totalSupply()).toString(), initialSupply.toString());
    assert.strictEqual((await this.token.balanceOf(holder)).toString(), initialSupply.toString());
  });

  it('transfers balances between accounts', async function () {
    await expectRevert(this.token.transfer(constants.ZERO_ADDRESS, '1', { from: holder }), 'MockERC20: transfer zero');

    const receipt = await this.token.transfer(recipient, '250', { from: holder });
    expectEvent(receipt, 'Transfer', { from: holder, to: recipient, value: new BN('250') });

    assert.strictEqual((await this.token.balanceOf(holder)).toString(), initialSupply.subn(250).toString());
    assert.strictEqual((await this.token.balanceOf(recipient)).toString(), '250');
  });

  it('manages allowances through approvals and adjustments', async function () {
    await expectRevert(this.token.approve(constants.ZERO_ADDRESS, '1', { from: holder }), 'MockERC20: approve zero');

    const approveReceipt = await this.token.approve(spender, '100', { from: holder });
    expectEvent(approveReceipt, 'Approval', { owner: holder, spender, value: new BN('100') });

    const increaseReceipt = await this.token.increaseAllowance(spender, '50', { from: holder });
    expectEvent(increaseReceipt, 'Approval', { owner: holder, spender, value: new BN('150') });

    await expectRevert(
      this.token.decreaseAllowance(spender, '200', { from: holder }),
      'MockERC20: allowance'
    );

    const decreaseReceipt = await this.token.decreaseAllowance(spender, '20', { from: holder });
    expectEvent(decreaseReceipt, 'Approval', { owner: holder, spender, value: new BN('130') });
    assert.strictEqual((await this.token.allowance(holder, spender)).toString(), '130');
  });

  it('spends allowance and preserves infinite approvals', async function () {
    await this.token.approve(spender, '100', { from: holder });
    await expectRevert(
      this.token.transferFrom(holder, recipient, '200', { from: spender }),
      'MockERC20: allowance'
    );

    await this.token.transferFrom(holder, recipient, '60', { from: spender });
    assert.strictEqual((await this.token.allowance(holder, spender)).toString(), '40');

    await this.token.approve(spender, constants.MAX_UINT256, { from: holder });
    await this.token.transferFrom(holder, recipient, '10', { from: spender });
    assert.strictEqual(
      (await this.token.allowance(holder, spender)).toString(),
      constants.MAX_UINT256.toString()
    );
  });
});
