const fs = require('fs');
const os = require('os');
const path = require('path');

const { validateAllConfigs } = require('../scripts/validate-config');
const { resolveVariant } = require('../scripts/config-loader');

contract('Configuration validation', () => {
  it('passes with repository configuration set', function () {
    const { errors } = validateAllConfigs();
    assert.deepEqual(errors, []);
  });

  it('detects invalid entries in mutated configuration payloads', function () {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agijobs-config-'));
    const configDir = path.join(__dirname, '..', 'config');
    fs.cpSync(configDir, tmpDir, { recursive: true });

    try {
      const agiMainnetPath = path.join(tmpDir, 'agialpha.mainnet.json');
      const agiMainnet = JSON.parse(fs.readFileSync(agiMainnetPath, 'utf8'));
      agiMainnet.token = '0x0000000000000000000000000000000000000000';
      agiMainnet.symbol = '';
      agiMainnet.name = '';
      fs.writeFileSync(agiMainnetPath, JSON.stringify(agiMainnet, null, 2));

      const ensMainnetPath = path.join(tmpDir, 'ens.mainnet.json');
      const ensMainnet = JSON.parse(fs.readFileSync(ensMainnetPath, 'utf8'));
      ensMainnet.agentRootHash = '0x1234';
      fs.writeFileSync(ensMainnetPath, JSON.stringify(ensMainnet, null, 2));

      const paramsPath = path.join(tmpDir, 'params.json');
      const params = JSON.parse(fs.readFileSync(paramsPath, 'utf8'));
      params.quorumMax = 1;
      params.quorumMin = 5;
      fs.writeFileSync(paramsPath, JSON.stringify(params, null, 2));

      const registrarMainnetPath = path.join(tmpDir, 'registrar.mainnet.json');
      const registrarMainnet = JSON.parse(fs.readFileSync(registrarMainnetPath, 'utf8'));
      registrarMainnet.defaultToken = '0x0000000000000000000000000000000000000001';
      registrarMainnet.address = '0x0000000000000000000000000000000000000000';
      registrarMainnet.domains[0].labels[0].minPrice = '-1';
      registrarMainnet.domains[0].labels[0].label = '';
      registrarMainnet.domains[0].labels[0].expectedToken =
        '0x0000000000000000000000000000000000000002';
      registrarMainnet.domains[0].labels.push({
        label: 'beta',
        minPrice: '10',
        maxPrice: '5',
      });
      fs.writeFileSync(registrarMainnetPath, JSON.stringify(registrarMainnet, null, 2));

      const { errors } = validateAllConfigs({ baseDir: tmpDir });
      assert.isAbove(errors.length, 0, 'expected validation errors');
      assert.isTrue(
        errors.some((message) => message.includes('agialpha.mainnet.json')),
        'should flag token address override'
      );
      assert.isTrue(
        errors.some((message) => message.includes('symbol must not be empty')),
        'should flag missing token symbol metadata'
      );
      assert.isTrue(
        errors.some((message) => message.includes('name must not be empty')),
        'should flag missing token name metadata'
      );
      assert.isTrue(
        errors.some((message) => message.includes('ens.mainnet.json')),
        'should flag ENS hash mismatch'
      );
      assert.isTrue(
        errors.some((message) => message.includes('params.json')),
        'should flag quorum ordering issue'
      );
      assert.isTrue(
        errors.some((message) => message.includes('registrar.mainnet.json')),
        'should flag registrar misconfiguration'
      );
      assert.isTrue(
        errors.some((message) => message.includes('defaultToken must equal')),
        'should require registrar default token to match agialpha token'
      );
      assert.isTrue(
        errors.some((message) => message.includes('labels.expectedToken must equal')),
        'should require registrar label tokens to match agialpha token'
      );
      assert.isTrue(
        errors.some((message) => message.includes('labels.maxPrice must be greater than or equal to minPrice')),
        'should flag inverted registrar price bounds'
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

contract('Config loader variant resolution', () => {
  it('normalizes development aliases to dev', function () {
    ['dev', 'development', 'localhost', 'hardhat', 'test', 'coverage'].forEach((alias) => {
      assert.strictEqual(resolveVariant(alias), 'dev');
    });
  });

  it('recognizes explicit mainnet and sepolia variants', function () {
    assert.strictEqual(resolveVariant('mainnet'), 'mainnet');
    assert.strictEqual(resolveVariant('sepolia'), 'sepolia');
  });

  it('throws for unsupported variants to avoid silent fallbacks', function () {
    assert.throws(() => resolveVariant('staging'), /Unsupported network variant/);
    assert.throws(() => resolveVariant('prod'), /Unsupported network variant/);
  });
});
