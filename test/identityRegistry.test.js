const { expectRevert, constants } = require('@openzeppelin/test-helpers');
const { hash: namehash } = require('eth-ens-namehash');

const IdentityRegistry = artifacts.require('IdentityRegistry');
const MockENSRegistry = artifacts.require('MockENSRegistry');
const MockENSNameWrapper = artifacts.require('MockENSNameWrapper');

contract('IdentityRegistry', (accounts) => {
  const [owner, stranger, emergency, worker, client] = accounts;

  beforeEach(async function () {
    this.registry = await IdentityRegistry.new({ from: owner });
  });

  it('allows owner to configure ENS registry', async function () {
    const agentHash = web3.utils.randomHex(32);
    const clubHash = web3.utils.randomHex(32);
    await this.registry.configureMainnet(stranger, worker, agentHash, clubHash, { from: owner });
    assert.strictEqual(await this.registry.ensRegistry(), stranger);
    assert.strictEqual(await this.registry.ensNameWrapper(), worker);
    assert.strictEqual(await this.registry.agentRootHash(), agentHash);
    assert.strictEqual(await this.registry.clubRootHash(), clubHash);
  });

  it('rejects configure from non-owner', async function () {
    await expectRevert(
      this.registry.configureMainnet(stranger, worker, web3.utils.randomHex(32), web3.utils.randomHex(32), {
        from: stranger
      }),
      'Ownable: caller is not the owner'
    );
  });

  it('requires a non-zero registry address', async function () {
    await expectRevert(
      this.registry.configureMainnet(
        constants.ZERO_ADDRESS,
        worker,
        web3.utils.randomHex(32),
        web3.utils.randomHex(32),
        {
          from: owner
        }
      ),
      'IdentityRegistry: registry'
    );
  });

  it('requires a non-zero wrapper address', async function () {
    await expectRevert(
      this.registry.configureMainnet(stranger, constants.ZERO_ADDRESS, web3.utils.randomHex(32), web3.utils.randomHex(32), {
        from: owner
      }),
      'IdentityRegistry: wrapper'
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
    const agent = web3.utils.keccak256('agent-root');
    const club = web3.utils.keccak256('club-root');
    await this.registry.configureMainnet(stranger, worker, agent, club, { from: owner });

    assert.isTrue(await this.registry.isAgentNode(agent));
    assert.isFalse(await this.registry.isAgentNode(web3.utils.randomHex(32)));
    assert.isTrue(await this.registry.isClubNode(club));
    assert.isFalse(await this.registry.isClubNode(web3.utils.randomHex(32)));
  });

  it('rejects zero root hashes during configuration', async function () {
    await expectRevert(
      this.registry.configureMainnet(stranger, worker, web3.utils.randomHex(32), '0x'.padEnd(66, '0'), {
        from: owner,
      }),
      'IdentityRegistry: club hash'
    );

    await expectRevert(
      this.registry.configureMainnet(stranger, worker, '0x'.padEnd(66, '0'), web3.utils.randomHex(32), {
        from: owner,
      }),
      'IdentityRegistry: agent hash'
    );
  });

  describe('ENS membership helpers', () => {
    const ZERO_NODE = '0x'.padEnd(66, '0');
    const labelhash = (label) => web3.utils.keccak256(label);

    beforeEach(async function () {
      this.ens = await MockENSRegistry.new({ from: owner });
      this.wrapper = await MockENSNameWrapper.new({ from: owner });
      this.agentRoot = namehash('agent.agi.eth');
      this.clubRoot = namehash('club.agi.eth');

      await this.registry.configureMainnet(this.ens.address, this.wrapper.address, this.agentRoot, this.clubRoot, {
        from: owner
      });

      await this.ens.setSubnodeOwner(ZERO_NODE, labelhash('eth'), owner, { from: owner });
      const ethNode = namehash('eth');
      await this.ens.setSubnodeOwner(ethNode, labelhash('agi'), owner, { from: owner });
      const agiNode = namehash('agi.eth');
      await this.ens.setSubnodeOwner(agiNode, labelhash('agent'), owner, { from: owner });
      await this.ens.setSubnodeOwner(agiNode, labelhash('club'), owner, { from: owner });
    });

    it('derives agent nodes and verifies ownership', async function () {
      const workerLabel = labelhash('builder');
      await this.ens.setSubnodeOwner(this.agentRoot, workerLabel, worker, { from: owner });

      assert.isTrue(await this.registry.isAgentAddress(worker, [workerLabel]));
      assert.isFalse(await this.registry.isAgentAddress(stranger, [workerLabel]));

      assert.strictEqual(await this.registry.agentNodeOwner([workerLabel]), worker);
    });

    it('resolves wrapped ownership via the NameWrapper', async function () {
      const workerLabel = labelhash('builder');
      await this.ens.setSubnodeOwner(this.agentRoot, workerLabel, this.wrapper.address, { from: owner });

      await this.wrapper.setWrappedOwner(
        web3.utils.soliditySha3({ type: 'bytes32', value: this.agentRoot }, { type: 'bytes32', value: workerLabel }),
        worker
      );

      assert.isTrue(await this.registry.isAgentAddress(worker, [workerLabel]));
      assert.strictEqual(await this.registry.agentNodeOwner([workerLabel]), worker);
    });

    it('falls back to getData when ownerOf is unavailable', async function () {
      const workerLabel = labelhash('builder');
      await this.ens.setSubnodeOwner(this.agentRoot, workerLabel, this.wrapper.address, { from: owner });

      const node = web3.utils.soliditySha3(
        { type: 'bytes32', value: this.agentRoot },
        { type: 'bytes32', value: workerLabel }
      );
      await this.wrapper.setWrappedOwner(node, worker);
      await this.wrapper.setOwnerOfEnabled(false);

      assert.isTrue(await this.registry.isAgentAddress(worker, [workerLabel]));
      assert.strictEqual(await this.registry.agentNodeOwner([workerLabel]), worker);
    });

    it('derives nested club nodes for alpha tiers', async function () {
      const alphaLabel = labelhash('alpha');
      const alphaNode = web3.utils.soliditySha3({ type: 'bytes32', value: this.clubRoot }, { type: 'bytes32', value: alphaLabel });
      await this.ens.setSubnodeOwner(this.clubRoot, alphaLabel, owner, { from: owner });

      const memberLabel = labelhash('vip');
      await this.ens.setSubnodeOwner(alphaNode, memberLabel, client, { from: owner });

      assert.isTrue(await this.registry.isClubAddress(client, [alphaLabel, memberLabel]));
      assert.isFalse(await this.registry.isClubAddress(worker, [alphaLabel, memberLabel]));

      assert.strictEqual(await this.registry.clubNodeOwner([alphaLabel, memberLabel]), client);
    });

    it('reverts when ENS registry is not configured', async function () {
      const unconfigured = await IdentityRegistry.new({ from: owner });
      await expectRevert(
        unconfigured.isAgentAddress(worker, [labelhash('any')]),
        'IdentityRegistry: ENS'
      );
    });

    it('resolves root ownership when labels are empty', async function () {
      assert.strictEqual(await this.registry.agentNodeOwner([]), owner);
      assert.strictEqual(await this.registry.clubNodeOwner([]), owner);
    });
  });
});
