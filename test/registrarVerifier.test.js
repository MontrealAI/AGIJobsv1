const { verifyRegistrar } = require('../scripts/verify-registrar.js');

const MockForeverSubdomainRegistrar = artifacts.require('MockForeverSubdomainRegistrar');
const MockSubdomainPricer = artifacts.require('MockSubdomainPricer');

contract('Registrar verification script', (accounts) => {
  const [deployer, treasury] = accounts;
  const AGIALPHA = '0xA61a3B3a130a9c20768EEBF97E21515A6046a1fA'.toLowerCase();

  beforeEach(async function () {
    this.registrar = await MockForeverSubdomainRegistrar.new({ from: deployer });
    this.pricer = await MockSubdomainPricer.new(AGIALPHA, web3.utils.toWei('5000'), { from: deployer });
    this.node = web3.utils.randomHex(32);
    await this.registrar.setName(this.node, this.pricer.address, treasury, true, { from: deployer });
  });

  function baseConfig(registrarAddress, node) {
    return {
      address: registrarAddress,
      defaultToken: AGIALPHA,
      domains: [
        {
          name: 'club.agi.eth',
          node,
          labels: [
            {
              label: 'alpha',
              minPrice: web3.utils.toWei('5000'),
              maxPrice: web3.utils.toWei('5000'),
            },
          ],
        },
      ],
    };
  }

  it('verifies active registrar domains and price metadata', async function () {
    const config = baseConfig(this.registrar.address, this.node);
    const result = await verifyRegistrar({
      web3,
      network: 'development',
      config,
      ensConfig: {},
      logger: { log() {} },
    });
    assert.isFalse(result.skipped);
    assert.strictEqual(result.results.length, 1);
    assert.strictEqual(result.results[0].labels.length, 1);
    assert.strictEqual(result.results[0].labels[0].token, AGIALPHA);
  });

  it('throws when registrar domain is inactive', async function () {
    await this.registrar.setName(this.node, this.pricer.address, treasury, false, { from: deployer });
    const config = baseConfig(this.registrar.address, this.node);
    try {
      await verifyRegistrar({ web3, network: 'development', config, ensConfig: {}, logger: { log() {} } });
      assert.fail('expected inactive registrar domain to fail verification');
    } catch (error) {
      assert.include(String(error.message || error), 'not active', 'should surface inactivity');
    }
  });

  it('throws when price token mismatches expected configuration', async function () {
    await this.pricer.setToken(accounts[9], { from: deployer });
    const config = baseConfig(this.registrar.address, this.node);
    try {
      await verifyRegistrar({ web3, network: 'development', config, ensConfig: {}, logger: { log() {} } });
      assert.fail('expected token mismatch to fail verification');
    } catch (error) {
      assert.include(String(error.message || error), 'token mismatch', 'should report token mismatch');
    }
  });

  it('throws when price exceeds configured maximum', async function () {
    await this.pricer.setPrice(web3.utils.toWei('6000'), { from: deployer });
    const config = baseConfig(this.registrar.address, this.node);
    try {
      await verifyRegistrar({ web3, network: 'development', config, ensConfig: {}, logger: { log() {} } });
      assert.fail('expected price ceiling breach to fail verification');
    } catch (error) {
      assert.include(String(error.message || error), 'exceeds maximum', 'should report ceiling breach');
    }
  });

  it('supports resolving nodes from ENS configuration root keys', async function () {
    const config = {
      address: this.registrar.address,
      defaultToken: AGIALPHA,
      domains: [
        {
          name: 'club.agi.eth',
          rootKey: 'clubRootHash',
          labels: [
            {
              label: 'alpha',
            },
          ],
        },
      ],
    };

    const ensConfig = { clubRootHash: this.node };
    const result = await verifyRegistrar({
      web3,
      network: 'development',
      config,
      ensConfig,
      logger: { log() {} },
    });

    assert.strictEqual(result.results[0].labels[0].token, AGIALPHA);
  });

  it('skips verification when registrar address is unset', async function () {
    const config = { address: null, domains: [] };
    const result = await verifyRegistrar({
      web3,
      network: 'development',
      config,
      ensConfig: {},
      logger: { log() {} },
    });
    assert.isTrue(result.skipped);
  });
});
