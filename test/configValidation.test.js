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
      ensMainnet.agentRoot = 'agents.agi.eth';
      ensMainnet.agentRootHash = '0x1111111111111111111111111111111111111111111111111111111111111111';
      ensMainnet.alphaAgentRoot = 'vip.agent.agi.eth';
      ensMainnet.alphaAgentRootHash = '0x2222222222222222222222222222222222222222222222222222222222222222';
      ensMainnet.alphaAgentEnabled = false;
      ensMainnet.clubRootHash = '0x4444444444444444444444444444444444444444444444444444444444444444';
      ensMainnet.alphaClubRootHash = '0x3333333333333333333333333333333333333333333333333333333333333333';
      ensMainnet.alphaEnabled = false;
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
      registrarMainnet.domains[1].labels[0].minPrice = '4000000000000000000000';
      registrarMainnet.domains[1].labels[0].maxPrice = '6000000000000000000000';
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
        errors.some((message) => message.includes('agentRoot must equal agent.agi.eth')),
        'should enforce canonical agent root on mainnet',
      );
      assert.isTrue(
        errors.some((message) => message.includes('agentRootHash must equal 0x2c9c6189b2e92da4d0407e9deb38ff6870729ad063af7e8576cb7b7898c88e2d')),
        'should enforce canonical agent root hash on mainnet',
      );
      assert.isTrue(
        errors.some((message) => message.includes('alphaAgentRoot must equal alpha.agent.agi.eth')),
        'should enforce alpha agent alias consistency'
      );
      assert.isTrue(
        errors.some((message) => message.includes('alphaAgentRootHash must equal 0xc74b6c5e8a0d97ed1fe28755da7d06a84593b4de92f6582327bc40f41d6c2d5e')),
        'should enforce canonical alpha agent hash on mainnet',
      );
      assert.isTrue(
        errors.some((message) => message.includes('alphaAgentEnabled must be true for mainnet deployments')),
        'should require alpha agent alias to remain active',
      );
      assert.isTrue(
        errors.some((message) => message.includes('clubRootHash must equal 0x39eb848f88bdfb0a6371096249dd451f56859dfe2cd3ddeab1e26d5bb68ede16')),
        'should enforce canonical club root hash on mainnet',
      );
      assert.isTrue(
        errors.some((message) => message.includes('alphaClubRootHash must equal 0x6487f659ec6f3fbd424b18b685728450d2559e4d68768393f9c689b2b6e5405e')),
        'should enforce canonical alpha club hash on mainnet',
      );
      assert.isTrue(
        errors.some((message) => message.includes('alphaEnabled must be true for mainnet deployments')),
        'should require alpha club alias to remain active',
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
        errors.some((message) =>
          message.includes('labels.maxPrice must be greater than or equal to minPrice')
        ),
        'should flag inverted registrar price bounds'
      );
      assert.isTrue(
        errors.some((message) => message.includes('alpha label must set minPrice and maxPrice')),
        'should enforce Alpha Club premium price floor'
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
