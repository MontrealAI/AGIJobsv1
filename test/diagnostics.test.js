const path = require('path');
const { expect } = require('chai');

const diagnostics = require('../scripts/diagnostics');

const {
  parseVersion,
  compareVersions,
  checkVersion,
  MIN_NODE_VERSION,
  MIN_NPM_VERSION,
} = diagnostics._internal;

describe('diagnostics utilities', () => {
  it('parses semantic versions with optional prerelease tags', () => {
    expect(parseVersion('1.2.3')).to.deep.equal([1, 2, 3]);
    expect(parseVersion('  10.0.1 ')).to.deep.equal([10, 0, 1]);
    expect(parseVersion('2.5.9-beta.1')).to.deep.equal([2, 5, 9]);
    expect(parseVersion('invalid')).to.equal(null);
    expect(parseVersion(42)).to.equal(null);
    expect(MIN_NODE_VERSION).to.be.a('string');
  });

  it('compares version strings correctly', () => {
    expect(compareVersions('1.2.3', '1.2.3')).to.equal(0);
    expect(compareVersions('1.3.0', '1.2.9')).to.equal(1);
    expect(compareVersions('1.2.3', '1.2.4')).to.equal(-1);
    expect(compareVersions('not-a-version', '1.0.0')).to.equal(null);
  });

  it('flags versions lower than the minimum requirement', () => {
    const status = checkVersion('0.1.0', '0.2.0');
    expect(status.ok).to.equal(false);
    expect(status.reason).to.match(/below the minimum/);
  });

  it('collects diagnostics with all checks satisfied', async () => {
    const report = await diagnostics.collectDiagnostics({
      env: {
        MNEMONIC: 'test',
        RPC_MAINNET: 'https://mainnet.invalid',
        RPC_SEPOLIA: 'https://sepolia.invalid',
        ETHERSCAN_API_KEY: 'key',
        GOV_SAFE: '0x1234',
        TIMELOCK_ADDR: '0x5678',
      },
      execFileAsync: async () => ({ stdout: `${MIN_NPM_VERSION}\n`, stderr: '' }),
      requireModule: (id) => ({ version: id.includes('hardhat') ? '2.17.2' : '5.11.5' }),
      validateConfigs: async () => ({ errors: [] }),
      existsSync: () => true,
      cwd: path.resolve(__dirname, '..'),
    });

    expect(report.summary.ok).to.equal(true);
    expect(report.errors).to.deep.equal([]);
    expect(report.warnings).to.deep.equal([]);
    expect(report.node.ok).to.equal(true);
    expect(report.npm.ok).to.equal(true);
    report.environment.forEach((entry) => expect(entry.present).to.equal(true));
  });

  it('surfaces failures when checks break down', async () => {
    const projectRoot = path.resolve(__dirname, '..');
    const missingFilePath = path.join(projectRoot, 'truffle-config.js');

    const report = await diagnostics.collectDiagnostics({
      env: {},
      execFileAsync: async () => {
        throw new Error('npm binary unavailable');
      },
      requireModule: () => {
        throw new Error('module not installed');
      },
      validateConfigs: async () => ({ errors: ['config broke'] }),
      existsSync: (filePath) => filePath !== missingFilePath,
      cwd: projectRoot,
    });

    expect(report.summary.ok).to.equal(false);
    expect(report.errors.some((message) => message.includes('npm check failed'))).to.equal(true);
    expect(report.errors.some((message) => message.includes('Dependency check failed for hardhat'))).to.equal(true);
    expect(report.errors.some((message) => message.includes('Configuration: config broke'))).to.equal(true);
    expect(report.files.missing).to.include('truffle-config.js');
    expect(report.environment.some((entry) => entry.present === false)).to.equal(true);
    expect(report.warnings.length).to.be.greaterThan(0);
  });
});
