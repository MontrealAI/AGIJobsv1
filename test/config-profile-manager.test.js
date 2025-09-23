const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { hash: namehash } = require('eth-ens-namehash');

const manager = require('../scripts/config-profile-manager.js');

function loadConfig(name) {
  const filePath = path.join(__dirname, '..', 'config', name);
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

describe('config-profile-manager utilities', () => {
  it('computes ENS hashes when updating roots', () => {
    const config = {};
    manager.ensureEnsRootConsistency(config, 'agentRoot', 'agent.agi.eth');
    assert.strictEqual(config.agentRoot, 'agent.agi.eth');
    assert.strictEqual(config.agentRootHash, namehash('agent.agi.eth'));

    manager.ensureEnsRootConsistency(config, 'agentRoot', null);
    assert.strictEqual(config.agentRoot, null);
    assert.strictEqual(config.agentRootHash, null);
  });

  it('rejects out-of-range decimals', () => {
    const config = {};
    assert.throws(
      () => manager.setAgialphaField(config, 'decimals', '512', { variant: 'dev' }),
      /between 0 and 255/
    );
  });

  it('applies directives and keeps ENS hashes synchronized', () => {
    const state = {
      agialpha: { value: {} },
      ens: { value: {} },
      registrar: { value: {} },
    };

    manager.applyDirective(state, 'ens.agentRoot=builder.agi.eth', { variant: 'dev' });
    assert.strictEqual(state.ens.value.agentRoot, 'builder.agi.eth');
    assert.strictEqual(state.ens.value.agentRootHash, namehash('builder.agi.eth'));

    manager.applyJsonDirective(
      state,
      'registrar.domains=[{"name":"agent.agi.eth","rootKey":"agentRootHash"}]',
      {
        variant: 'dev',
      }
    );
    assert.deepStrictEqual(state.registrar.value.domains, [
      { name: 'agent.agi.eth', rootKey: 'agentRootHash' },
    ]);
  });

  it('accepts existing dev configuration during validation', () => {
    const agialpha = loadConfig('agialpha.dev.json');
    const ens = loadConfig('ens.dev.json');
    const registrar = loadConfig('registrar.dev.json');

    assert.doesNotThrow(() =>
      manager.validateVariantConfig({ variant: 'dev', agialpha, ens, registrar })
    );
  });
});
