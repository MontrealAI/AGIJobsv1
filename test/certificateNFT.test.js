const { expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const CertificateNFT = artifacts.require('CertificateNFT');

contract('CertificateNFT', (accounts) => {
  const [owner, recipient, newOwner] = accounts;

  beforeEach(async function () {
    this.nft = await CertificateNFT.new({ from: owner });
  });

  it('issues sequential certificates and emits events', async function () {
    const tx = await this.nft.issue(recipient, 'ipfs://hash1', { from: owner });
    expectEvent(tx, 'CertificateIssued', { to: recipient, id: web3.utils.toBN(1) });

    const second = await this.nft.issue(recipient, 'ipfs://hash2', { from: owner });
    expectEvent(second, 'CertificateIssued', { id: web3.utils.toBN(2) });
  });

  it('rejects issuing to the zero address', async function () {
    await expectRevert(this.nft.issue(constants.ZERO_ADDRESS, 'uri', { from: owner }), 'CertificateNFT: zero');
  });

  it('enforces ownership transfers', async function () {
    await expectRevert(this.nft.issue(recipient, 'uri', { from: recipient }), 'Ownable: caller is not the owner');

    const receipt = await this.nft.transferOwnership(newOwner, { from: owner });
    expectEvent(receipt, 'OwnershipTransferred', { previousOwner: owner, newOwner });

    await expectRevert(
      this.nft.transferOwnership(constants.ZERO_ADDRESS, { from: newOwner }),
      'Ownable: zero address'
    );

    await this.nft.issue(recipient, 'uri', { from: newOwner });
  });
});
