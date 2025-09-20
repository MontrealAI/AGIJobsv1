const IdentityRegistry = artifacts.require('IdentityRegistry');
const StakeManager = artifacts.require('StakeManager');
const FeePool = artifacts.require('FeePool');
const ValidationModule = artifacts.require('ValidationModule');
const DisputeModule = artifacts.require('DisputeModule');
const ReputationEngine = artifacts.require('ReputationEngine');
const CertificateNFT = artifacts.require('CertificateNFT');
const JobRegistry = artifacts.require('JobRegistry');
const MockERC20 = artifacts.require('MockERC20');

const { readConfig } = require('../scripts/config-loader');

const MOCK_TOKEN_MARKER = 'mock';

module.exports = async function (deployer, network, accounts) {
  const agiCfg = readConfig('agialpha', network);

  let stakeTokenAddress = agiCfg.token;
  if (typeof stakeTokenAddress === 'string' && stakeTokenAddress.toLowerCase() === MOCK_TOKEN_MARKER) {
    const initialSupply = (1_000_000n * 10n ** BigInt(agiCfg.decimals)).toString();
    await deployer.deploy(
      MockERC20,
      'Mock AGI Alpha',
      'mAGIA',
      agiCfg.decimals,
      accounts[0],
      initialSupply
    );
    const mockToken = await MockERC20.deployed();
    stakeTokenAddress = mockToken.address;
  }

  await deployer.deploy(IdentityRegistry);
  await deployer.deploy(StakeManager, stakeTokenAddress, agiCfg.decimals);
  await deployer.deploy(FeePool, stakeTokenAddress, agiCfg.burnAddress);
  await deployer.deploy(ValidationModule);
  await deployer.deploy(DisputeModule);
  await deployer.deploy(ReputationEngine);
  await deployer.deploy(CertificateNFT);
  await deployer.deploy(JobRegistry);
};
