const { expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const ValidationModule = artifacts.require('ValidationModule');

contract('ValidationModule', (accounts) => {
  const [owner, stranger] = accounts;

  beforeEach(async function () {
    this.validation = await ValidationModule.new({ from: owner });
  });

  it('allows owner to toggle validation rules', async function () {
    const rule = web3.utils.soliditySha3('rule');
    const receipt = await this.validation.setValidationRule(rule, true, { from: owner });
    expectEvent(receipt, 'ValidationRuleUpdated', { rule, enabled: true });
    assert.isTrue(await this.validation.validationRules(rule));

    await this.validation.setValidationRule(rule, false, { from: owner });
    assert.isFalse(await this.validation.validationRules(rule));
  });

  it('prevents non-owners from updating rules', async function () {
    const rule = web3.utils.randomHex(32);
    await expectRevert(
      this.validation.setValidationRule(rule, true, { from: stranger }),
      'Ownable: caller is not the owner'
    );
  });
});
