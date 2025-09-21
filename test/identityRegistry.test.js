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
    const alphaHash = web3.utils.randomHex(32);
    await this.registry.configureEns(stranger, worker, agentHash, clubHash, alphaHash, true, { from: owner });
    assert.strictEqual(await this.registry.ensRegistry(), stranger);
    assert.strictEqual(await this.registry.ensNameWrapper(), worker);
    assert.strictEqual(await this.registry.agentRootHash(), agentHash);
    assert.strictEqual(await this.registry.clubRootHash(), clubHash);
    assert.strictEqual(await this.registry.alphaClubRootHash(), alphaHash);
    assert.isTrue(await this.registry.alphaEnabled());
  });

  it('rejects configure from non-owner', async function () {
    await expectRevert(
      this.registry.configureEns(
        stranger,
        worker,
        web3.utils.randomHex(32),
        web3.utils.randomHex(32),
        web3.utils.randomHex(32),
        true,
        {
          from: stranger,
        }
      ),
      'Ownable: caller is not the owner'
    );
  });

  it('requires a non-zero registry address', async function () {
    await expectRevert(
      this.registry.configureEns(
        constants.ZERO_ADDRESS,
        worker,
        web3.utils.randomHex(32),
        web3.utils.randomHex(32),
        web3.utils.randomHex(32),
        false,
        {
          from: owner
        }
      ),
      'IdentityRegistry: registry'
    );
  });

  it('accepts a zero wrapper address for networks without NameWrapper', async function () {
    const agentHash = web3.utils.randomHex(32);
    const clubHash = web3.utils.randomHex(32);
    await this.registry.configureEns(
      stranger,
      constants.ZERO_ADDRESS,
      agentHash,
      clubHash,
      '0x'.padEnd(66, '0'),
      false,
      {
        from: owner,
      }
    );

    assert.strictEqual(await this.registry.ensNameWrapper(), constants.ZERO_ADDRESS);
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
    await this.registry.configureEns(stranger, worker, agent, club, '0x'.padEnd(66, '0'), false, { from: owner });

    assert.isTrue(await this.registry.isAgentNode(agent));
    assert.isFalse(await this.registry.isAgentNode(web3.utils.randomHex(32)));
    assert.isTrue(await this.registry.isClubNode(club));
    assert.isFalse(await this.registry.isClubNode(web3.utils.randomHex(32)));
  });

  it('rejects zero root hashes during configuration', async function () {
    await expectRevert(
      this.registry.configureEns(
        stranger,
        worker,
        web3.utils.randomHex(32),
        '0x'.padEnd(66, '0'),
        web3.utils.randomHex(32),
        false,
        {
          from: owner,
        }
      ),
      'IdentityRegistry: club hash'
    );

    await expectRevert(
      this.registry.configureEns(
        stranger,
        worker,
        '0x'.padEnd(66, '0'),
        web3.utils.randomHex(32),
        web3.utils.randomHex(32),
        false,
        {
          from: owner,
        }
      ),
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
      this.alphaLabel = labelhash('alpha');
      this.alphaRoot = web3.utils.soliditySha3(
        { type: 'bytes32', value: this.clubRoot },
        { type: 'bytes32', value: this.alphaLabel }
      );

      await this.registry.configureEns(
        this.ens.address,
        this.wrapper.address,
        this.agentRoot,
        this.clubRoot,
        this.alphaRoot,
        false,
        {
          from: owner,
        }
      );

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

    it('derives nested club nodes for alpha tiers gated by activation flag', async function () {
      await this.ens.setSubnodeOwner(this.clubRoot, this.alphaLabel, owner, { from: owner });

      const memberLabel = labelhash('vip');
      await this.ens.setSubnodeOwner(this.alphaRoot, memberLabel, client, { from: owner });

      assert.isFalse(
        await this.registry.isClubAddress(client, [this.alphaLabel, memberLabel]),
        'alpha identities remain inactive until alphaEnabled flips'
      );
      assert.isFalse(await this.registry.isClubAddress(worker, [this.alphaLabel, memberLabel]));
      await expectRevert.unspecified(this.registry.clubNodeOwner([this.alphaLabel, memberLabel]));

      await this.registry.configureEns(
        this.ens.address,
        this.wrapper.address,
        this.agentRoot,
        this.clubRoot,
        this.alphaRoot,
        true,
        {
          from: owner,
        }
      );

      assert.isTrue(await this.registry.isClubAddress(client, [this.alphaLabel, memberLabel]));
      assert.isFalse(await this.registry.isClubAddress(worker, [this.alphaLabel, memberLabel]));

      assert.strictEqual(await this.registry.clubNodeOwner([this.alphaLabel, memberLabel]), client);
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
