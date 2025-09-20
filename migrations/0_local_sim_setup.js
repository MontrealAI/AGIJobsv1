const fs = require('fs');

const MockERC20 = artifacts.require('MockERC20');
const MockENSRegistry = artifacts.require('MockENSRegistry');

const { configPath, readConfig } = require('../scripts/config-loader');

module.exports = async function (deployer, network, accounts) {
  if (network !== 'development') {
    return;
  }

  const agiConfigPath = configPath('agialpha', network);
  const ensConfigPath = configPath('ens', network);

  const agiConfig = readConfig('agialpha', network);
  const ensConfig = readConfig('ens', network);

  const initialSupply = (
    1_000_000n * 10n ** BigInt(agiConfig.decimals)
  ).toString();

  await deployer.deploy(
    MockERC20,
    'Mock AGI Alpha',
    'mAGIA',
    agiConfig.decimals,
    accounts[0],
    initialSupply
  );
  const mockToken = await MockERC20.deployed();

  await deployer.deploy(MockENSRegistry);
  const mockEns = await MockENSRegistry.deployed();

  agiConfig.token = mockToken.address;
  ensConfig.registry = mockEns.address;

  fs.writeFileSync(agiConfigPath, `${JSON.stringify(agiConfig, null, 2)}\n`);
  fs.writeFileSync(ensConfigPath, `${JSON.stringify(ensConfig, null, 2)}\n`);

  console.log(`MockERC20 deployed at ${mockToken.address}`);
  console.log(`MockENSRegistry deployed at ${mockEns.address}`);
};
