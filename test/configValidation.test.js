const fs = require('fs');
const os = require('os');
const path = require('path');

const { validateAllConfigs } = require('../scripts/validate-config');

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

      const { errors } = validateAllConfigs({ baseDir: tmpDir });
      assert.isAbove(errors.length, 0, 'expected validation errors');
      assert.isTrue(
        errors.some((message) => message.includes('agialpha.mainnet.json')),
        'should flag token address override'
      );
      assert.isTrue(
        errors.some((message) => message.includes('ens.mainnet.json')),
        'should flag ENS hash mismatch'
      );
      assert.isTrue(
        errors.some((message) => message.includes('params.json')),
        'should flag quorum ordering issue'
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
