const { expectEvent, expectRevert, BN } = require('@openzeppelin/test-helpers');
const ValidationModule = artifacts.require('ValidationModule');

contract('ValidationModule', (accounts) => {
  const [owner, registry, validator, stranger] = accounts;

  beforeEach(async function () {
    this.validation = await ValidationModule.new({ from: owner });
  });

  it('configures the registry exactly once', async function () {
    const receipt = await this.validation.setJobRegistry(registry, { from: owner });
    expectEvent(receipt, 'JobRegistryUpdated', { jobRegistry: registry });

    await expectRevert.unspecified(this.validation.setJobRegistry(stranger, { from: owner }));
    await expectRevert.unspecified(
      this.validation.updateJobRegistry('0x0000000000000000000000000000000000000000', { from: owner })
    );

    const newRegistry = accounts[5];
    const updateReceipt = await this.validation.updateJobRegistry(newRegistry, { from: owner });
    expectEvent(updateReceipt, 'JobRegistryUpdated', { jobRegistry: newRegistry });
  });

  it('restricts registry configuration to the owner', async function () {
    await expectRevert(this.validation.setJobRegistry(registry, { from: stranger }), 'Ownable: caller is not the owner');
  });

  it('enforces commit-reveal semantics for validator votes', async function () {
    await this.validation.setJobRegistry(registry, { from: owner });

    const jobId = new BN(7);
    const salt = web3.utils.randomHex(32);
    const commitment = await this.validation.computeCommitment(jobId, validator, true, salt);
    await this.validation.commitValidation(jobId, commitment, { from: validator });

    await expectRevert.unspecified(
      this.validation.revealValidation(jobId, true, web3.utils.randomHex(32), { from: validator })
    );

    const revealReceipt = await this.validation.revealValidation(jobId, true, salt, { from: validator });
    expectEvent(revealReceipt, 'ValidationRevealed', { jobId, validator, approved: true });

    const approvals = await this.validation.approvals(jobId);
    assert(approvals.eq(new BN(1)));
    const hasRevealed = await this.validation.hasRevealed(jobId, validator);
    assert.strictEqual(hasRevealed, true);
  });

  it('guards finalize and dispute transitions', async function () {
    await this.validation.setJobRegistry(registry, { from: owner });
    const jobId = new BN(12);
    const salt = web3.utils.randomHex(32);
    const commitment = await this.validation.computeCommitment(jobId, validator, false, salt);
    await this.validation.commitValidation(jobId, commitment, { from: validator });

    await expectRevert.unspecified(this.validation.beforeFinalize(jobId, { from: registry }));

    await this.validation.revealValidation(jobId, false, salt, { from: validator });
    await this.validation.beforeFinalize(jobId, { from: registry });

    await expectRevert.unspecified(this.validation.beforeFinalize(jobId, { from: registry }));

    await expectRevert.unspecified(this.validation.beforeDispute(jobId, { from: registry }));
  });

  it('tracks dispute lifecycle and pending commits', async function () {
    await this.validation.setJobRegistry(registry, { from: owner });
    const jobId = new BN(3);
    const salt = web3.utils.randomHex(32);
    const commitment = await this.validation.computeCommitment(jobId, validator, true, salt);
    await this.validation.commitValidation(jobId, commitment, { from: validator });

    await this.validation.beforeDispute(jobId, { from: registry });
    await expectRevert.unspecified(this.validation.beforeDispute(jobId, { from: registry }));

    await expectRevert.unspecified(this.validation.beforeDisputeResolution(jobId, { from: registry }));

    await this.validation.revealValidation(jobId, true, salt, { from: validator });
    await this.validation.beforeDisputeResolution(jobId, { from: registry });

    await expectRevert.unspecified(this.validation.beforeDisputeResolution(jobId, { from: registry }));
  });
});
