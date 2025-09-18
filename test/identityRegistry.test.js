const { expectRevert } = require('@openzeppelin/test-helpers');
const IdentityRegistry = artifacts.require('IdentityRegistry');

contract('IdentityRegistry', (accounts) => {
  const [owner, stranger] = accounts;

  it('allows owner to configure ENS registry', async () => {
    const registry = await IdentityRegistry.new({ from: owner });
    await registry.configureMainnet(stranger, web3.utils.randomHex(32), web3.utils.randomHex(32), { from: owner });
    assert.strictEqual(await registry.ensRegistry(), stranger);
  });

  it('rejects configure from non-owner', async () => {
    const registry = await IdentityRegistry.new({ from: owner });
    await expectRevert(
      registry.configureMainnet(stranger, web3.utils.randomHex(32), web3.utils.randomHex(32), { from: stranger }),
      'Ownable: caller is not the owner'
    );
  });
});
