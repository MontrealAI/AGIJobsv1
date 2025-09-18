const { expectRevert, constants } = require('@openzeppelin/test-helpers');
const IdentityRegistry = artifacts.require('IdentityRegistry');

contract('IdentityRegistry', (accounts) => {
  const [owner, stranger, emergency] = accounts;

  beforeEach(async function () {
    this.registry = await IdentityRegistry.new({ from: owner });
  });

  it('allows owner to configure ENS registry', async function () {
    const agentHash = web3.utils.randomHex(32);
    const clubHash = web3.utils.randomHex(32);
    await this.registry.configureMainnet(stranger, agentHash, clubHash, { from: owner });
    assert.strictEqual(await this.registry.ensRegistry(), stranger);
    assert.strictEqual(await this.registry.agentRootHash(), agentHash);
    assert.strictEqual(await this.registry.clubRootHash(), clubHash);
  });

  it('rejects configure from non-owner', async function () {
    await expectRevert(
      this.registry.configureMainnet(stranger, web3.utils.randomHex(32), web3.utils.randomHex(32), { from: stranger }),
      'Ownable: caller is not the owner'
    );
  });

  it('requires a non-zero registry address', async function () {
    await expectRevert(
      this.registry.configureMainnet(constants.ZERO_ADDRESS, web3.utils.randomHex(32), web3.utils.randomHex(32), {
        from: owner
      }),
      'IdentityRegistry: registry'
    );
  });

  it('manages emergency allow list and queries', async function () {
    await this.registry.setEmergencyAccess(emergency, true, { from: owner });
    assert.isTrue(await this.registry.hasEmergencyAccess(emergency));

    await this.registry.setEmergencyAccess(emergency, false, { from: owner });
    assert.isFalse(await this.registry.hasEmergencyAccess(emergency));

    await expectRevert(
      this.registry.setEmergencyAccess(emergency, true, { from: stranger }),
      'Ownable: caller is not the owner'
    );
  });

  it('validates agent and club node hashes', async function () {
    const agent = web3.utils.randomHex(32);
    const club = web3.utils.randomHex(32);
    await this.registry.configureMainnet(stranger, agent, club, { from: owner });

    assert.isTrue(await this.registry.isAgentNode(agent));
    assert.isFalse(await this.registry.isAgentNode(web3.utils.randomHex(32)));
    assert.isTrue(await this.registry.isClubNode(club));
    assert.isFalse(await this.registry.isClubNode(web3.utils.randomHex(32)));
  });
});
