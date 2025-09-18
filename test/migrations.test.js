const { expectRevert } = require('@openzeppelin/test-helpers');
const Migrations = artifacts.require('Migrations');

contract('Migrations', (accounts) => {
  const [owner, stranger] = accounts;

  beforeEach(async function () {
    this.migrations = await Migrations.new({ from: owner });
  });

  it('initializes owner and updates completed migration', async function () {
    assert.strictEqual(await this.migrations.owner(), owner);
    await this.migrations.setCompleted(2, { from: owner });
    assert.strictEqual((await this.migrations.lastCompletedMigration()).toString(), '2');
  });

  it('rejects completion updates from non-owner', async function () {
    await expectRevert(this.migrations.setCompleted(1, { from: stranger }), 'Migrations: not owner');
  });
});
