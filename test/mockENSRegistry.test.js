const { expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const MockENSRegistry = artifacts.require('MockENSRegistry');

contract('MockENSRegistry', (accounts) => {
  const [deployer, newOwner, thirdParty] = accounts;

  const ZERO_NODE = '0x' + '0'.repeat(64);

  beforeEach(async function () {
    this.registry = await MockENSRegistry.new({ from: deployer });
  });

  it('sets the root owner to the deployer and emits an event', async function () {
    assert.strictEqual(await this.registry.owner(ZERO_NODE), deployer);
  });

  it('allows the current owner to update node ownership', async function () {
    const label = web3.utils.keccak256('node');
    const creationTx = await this.registry.setSubnodeOwner(ZERO_NODE, label, deployer, { from: deployer });
    const node = web3.utils.soliditySha3({ type: 'bytes32', value: ZERO_NODE }, { type: 'bytes32', value: label });
    expectEvent(creationTx, 'Transfer', { node, owner: deployer });

    await expectRevert(
      this.registry.setOwner(node, newOwner, { from: thirdParty }),
      'MockENSRegistry: owner'
    );

    const receipt = await this.registry.setOwner(node, newOwner, { from: deployer });
    expectEvent(receipt, 'Transfer', { node, owner: newOwner });
    assert.strictEqual(await this.registry.owner(node), newOwner);

    await expectRevert(
      this.registry.setOwner(node, deployer, { from: deployer }),
      'MockENSRegistry: owner'
    );

    const transferBack = await this.registry.setOwner(node, deployer, { from: newOwner });
    expectEvent(transferBack, 'Transfer', { node, owner: deployer });
    assert.strictEqual(await this.registry.owner(node), deployer);
  });

  it('derives subnode ownership and emits the expected events', async function () {
    const rootLabel = web3.utils.keccak256('root');
    const rootTx = await this.registry.setSubnodeOwner(ZERO_NODE, rootLabel, deployer, { from: deployer });
    const node = web3.utils.soliditySha3(
      { type: 'bytes32', value: ZERO_NODE },
      { type: 'bytes32', value: rootLabel }
    );
    expectEvent(rootTx, 'Transfer', { node, owner: deployer });

    const label = web3.utils.keccak256('label');
    const tx = await this.registry.setSubnodeOwner(node, label, newOwner, { from: deployer });
    const subnode = web3.utils.soliditySha3({ type: 'bytes32', value: node }, { type: 'bytes32', value: label });

    expectEvent(tx, 'Transfer', { node: subnode, owner: newOwner });
    expectEvent(tx, 'NewOwner', { node, label, owner: newOwner });
    assert.strictEqual(await this.registry.owner(subnode), newOwner);

    await expectRevert(
      this.registry.setSubnodeOwner(node, label, deployer, { from: thirdParty }),
      'MockENSRegistry: owner'
    );
  });
});
