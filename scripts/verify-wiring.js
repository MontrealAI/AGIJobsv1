const JobRegistry = artifacts.require('JobRegistry');
const IdentityRegistry = artifacts.require('IdentityRegistry');
const StakeManager = artifacts.require('StakeManager');
const ValidationModule = artifacts.require('ValidationModule');
const DisputeModule = artifacts.require('DisputeModule');
const ReputationEngine = artifacts.require('ReputationEngine');
const FeePool = artifacts.require('FeePool');
const CertificateNFT = artifacts.require('CertificateNFT');

const { hash: computeNamehash, normalize: normalizeEnsName } = require('eth-ens-namehash');

const params = require('../config/params.json');
const { readConfig, resolveVariant } = require('./config-loader');

const NAME_WRAPPER_ABI = [
  {
    constant: true,
    inputs: [],
    name: 'ens',
    outputs: [{ name: '', type: 'address' }],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
];

const ENS_REGISTRY_ABI = [
  {
    constant: true,
    inputs: [{ name: 'node', type: 'bytes32' }],
    name: 'owner',
    outputs: [{ name: '', type: 'address' }],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
  {
    constant: true,
    inputs: [{ name: 'node', type: 'bytes32' }],
    name: 'recordExists',
    outputs: [{ name: '', type: 'bool' }],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
];

const ZERO_NAMEHASH = '0x0000000000000000000000000000000000000000000000000000000000000000';

const MAINNET_EXPECTATIONS = Object.freeze({
  agiToken: '0xA61a3B3a130a9c20768EEBF97E21515A6046a1fA',
  agiSymbol: 'AGIALPHA',
  agiName: 'AGI ALPHA AGENT',
  ensRegistry: '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e',
  nameWrapper: '0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401',
  agentRoot: 'agent.agi.eth',
  agentRootHash: '0x2c9c6189b2e92da4d0407e9deb38ff6870729ad063af7e8576cb7b7898c88e2d',
  clubRoot: 'club.agi.eth',
  clubRootHash: '0x39eb848f88bdfb0a6371096249dd451f56859dfe2cd3ddeab1e26d5bb68ede16',
});

function ensureEnsName(value, label) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string when specified`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} must not be empty when specified`);
  }

  try {
    const normalized = normalizeEnsName(trimmed);
    if (normalized !== trimmed) {
      throw new Error(`${label} must be normalized; expected "${normalized}" but received "${value}"`);
    }
    return normalized;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    throw new Error(`Invalid ENS name for ${label}: ${message}`);
  }
}

function extractNetwork(argv) {
  const networkFlagIndex = argv.findIndex((arg) => arg === '--network');
  if (networkFlagIndex !== -1 && argv[networkFlagIndex + 1]) {
    return argv[networkFlagIndex + 1];
  }

  return undefined;
}

async function callOptionalTokenMethod(address, selector) {
  try {
    const result = await web3.eth.call({ to: address, data: selector });
    if (!result || result === '0x') {
      return null;
    }
    return result;
  } catch (error) {
    const message = String(error && error.message ? error.message : error).toLowerCase();
    if (
      message.includes('execution reverted') ||
      message.includes('revert') ||
      message.includes('invalid opcode') ||
      message.includes('method not found') ||
      (typeof error?.code === 'number' && (error.code === -32601 || error.code === 3))
    ) {
      console.warn(`Warning: token at ${address} did not respond to selector ${selector}; skipping.`);
      return null;
    }

    throw error;
  }
}

async function fetchTokenMetadata(address) {
  const abi = web3.eth.abi;

  const [decimalsData, symbolData, nameData] = await Promise.all([
    callOptionalTokenMethod(address, '0x313ce567'), // decimals()
    callOptionalTokenMethod(address, '0x95d89b41'), // symbol()
    callOptionalTokenMethod(address, '0x06fdde03'), // name()
  ]);

  let decimals = null;
  if (decimalsData) {
    try {
      decimals = Number(abi.decodeParameter('uint8', decimalsData));
    } catch (decodeError) {
      console.warn(`Warning: failed to decode decimals() for token ${address}: ${decodeError}`);
    }
  }

  let symbol = null;
  if (symbolData) {
    try {
      symbol = abi.decodeParameter('string', symbolData);
    } catch (decodeError) {
      console.warn(`Warning: failed to decode symbol() for token ${address}: ${decodeError}`);
    }
  }

  let name = null;
  if (nameData) {
    try {
      name = abi.decodeParameter('string', nameData);
    } catch (decodeError) {
      console.warn(`Warning: failed to decode name() for token ${address}: ${decodeError}`);
    }
  }

  return { decimals, symbol, name };
}

function normalizeString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

module.exports = async function (callback) {
  try {
    const { GOV_SAFE, TIMELOCK_ADDR } = process.env;
    const expectedOwner = GOV_SAFE || TIMELOCK_ADDR;

    const networkName =
      extractNetwork(process.argv) || process.env.NETWORK || process.env.TRUFFLE_NETWORK;
    const agiCfg = readConfig('agialpha', networkName);
    const ensCfg = readConfig('ens', networkName);
    const variant = resolveVariant(networkName);
    const isMainnet = variant === 'mainnet';
    const hasEnsConfig = ensCfg && typeof ensCfg === 'object';

    let normalizedAgentRootName = null;
    let normalizedClubRootName = null;
    if (hasEnsConfig) {
      normalizedAgentRootName = ensureEnsName(ensCfg.agentRoot, 'config.ens.agentRoot');
      normalizedClubRootName = ensureEnsName(ensCfg.clubRoot, 'config.ens.clubRoot');
    }

    const jobRegistry = await JobRegistry.deployed();
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
    const modules = await jobRegistry.modules();

    const expectEq = (lhs, rhs, label) => {
      const left = lhs.toLowerCase();
      if (left === ZERO_ADDRESS) {
        throw new Error(`Zero address for ${label}`);
      }
      if (left !== rhs.toLowerCase()) {
        throw new Error(`Mismatch for ${label}: ${lhs} !== ${rhs}`);
      }
    };

    const ensureOwner = (value, label, expected) => {
      const normalizedValue = value.toLowerCase();
      if (normalizedValue === ZERO_ADDRESS) {
        throw new Error(`Zero address for ${label}`);
      }
      if (expected && normalizedValue !== expected.toLowerCase()) {
        throw new Error(
          `Ownership mismatch for ${label}: expected ${expected} but found ${value}`
        );
      }
    };

    if (isMainnet) {
      if (!agiCfg || typeof agiCfg !== 'object') {
        throw new Error('Missing agialpha configuration for mainnet run');
      }
      if (!ensCfg || typeof ensCfg !== 'object') {
        throw new Error('Missing ENS configuration for mainnet run');
      }

      if (typeof agiCfg.token !== 'string' || agiCfg.token.toLowerCase() === 'mock') {
        throw new Error('Mainnet requires a configured AGIALPHA token address');
      }
      expectEq(agiCfg.token, MAINNET_EXPECTATIONS.agiToken, 'config.agialpha.token (mainnet)');

      const cfgSymbol = normalizeString(agiCfg.symbol);
      if (cfgSymbol !== MAINNET_EXPECTATIONS.agiSymbol) {
        throw new Error(
          `config.agialpha.symbol must equal ${MAINNET_EXPECTATIONS.agiSymbol} on mainnet but was ${agiCfg.symbol}`
        );
      }

      const cfgName = normalizeString(agiCfg.name);
      if (cfgName !== MAINNET_EXPECTATIONS.agiName) {
        throw new Error(
          `config.agialpha.name must equal ${MAINNET_EXPECTATIONS.agiName} on mainnet but was ${agiCfg.name}`
        );
      }

      if (!ensCfg.registry) {
        throw new Error('config/ens.mainnet.json must define the ENS registry address');
      }
      expectEq(ensCfg.registry, MAINNET_EXPECTATIONS.ensRegistry, 'config.ens.registry (mainnet)');

      if (!normalizedAgentRootName) {
        throw new Error('config/ens.mainnet.json must define the agentRoot');
      }
      if (normalizedAgentRootName !== MAINNET_EXPECTATIONS.agentRoot) {
        throw new Error(
          `config.ens.agentRoot must equal ${MAINNET_EXPECTATIONS.agentRoot} on mainnet but was ${ensCfg.agentRoot}`
        );
      }

      if (!ensCfg.agentRootHash) {
        throw new Error('config/ens.mainnet.json must define the agentRootHash');
      }
      expectEq(ensCfg.agentRootHash, MAINNET_EXPECTATIONS.agentRootHash, 'config.ens.agentRootHash (mainnet)');

      if (!normalizedClubRootName) {
        throw new Error('config/ens.mainnet.json must define the clubRoot');
      }
      if (normalizedClubRootName !== MAINNET_EXPECTATIONS.clubRoot) {
        throw new Error(
          `config.ens.clubRoot must equal ${MAINNET_EXPECTATIONS.clubRoot} on mainnet but was ${ensCfg.clubRoot}`
        );
      }

      if (!ensCfg.clubRootHash) {
        throw new Error('config/ens.mainnet.json must define the clubRootHash');
      }
      expectEq(ensCfg.clubRootHash, MAINNET_EXPECTATIONS.clubRootHash, 'config.ens.clubRootHash (mainnet)');

      const wrapperAddress = normalizeString(ensCfg.nameWrapper);
      if (!wrapperAddress) {
        throw new Error('config/ens.mainnet.json must define the ENS NameWrapper address');
      }
      expectEq(wrapperAddress, MAINNET_EXPECTATIONS.nameWrapper, 'config.ens.nameWrapper (mainnet)');
    }

    if (expectedOwner) {
      console.log(`Checking ownership against ${expectedOwner}`);
    }

    const owner = await jobRegistry.owner();
    const ownerCheckTarget = expectedOwner || owner;
    ensureOwner(owner, 'jobRegistry.owner', ownerCheckTarget);

    const identity = await IdentityRegistry.deployed();
    const staking = await StakeManager.deployed();
    const validation = await ValidationModule.deployed();
    const dispute = await DisputeModule.deployed();
    const reputation = await ReputationEngine.deployed();
    const feePool = await FeePool.deployed();
    const certificate = await CertificateNFT.deployed();

    [
      ['identity', modules.identity, identity.address],
      ['staking', modules.staking, staking.address],
      ['validation', modules.validation, validation.address],
      ['dispute', modules.dispute, dispute.address],
      ['reputation', modules.reputation, reputation.address],
      ['feePool', modules.feePool, feePool.address],
    ].forEach(([label, actual, expected]) => {
      expectEq(actual, expected, label);
    });

    await Promise.all(
      [
        ['identity.owner', identity.owner()],
        ['staking.owner', staking.owner()],
        ['validation.owner', validation.owner()],
        ['dispute.owner', dispute.owner()],
        ['reputation.owner', reputation.owner()],
        ['feePool.owner', feePool.owner()],
        ['certificate.owner', certificate.owner()],
      ].map(async ([label, valuePromise]) => {
        const value = await valuePromise;
        ensureOwner(value, label, ownerCheckTarget);
      })
    );

    expectEq(await staking.jobRegistry(), jobRegistry.address, 'staking.jobRegistry');
    expectEq(
      await staking.feeRecipient(),
      feePool.address,
      'staking.feeRecipient'
    );
    expectEq(await feePool.jobRegistry(), jobRegistry.address, 'feePool.jobRegistry');
    expectEq(await dispute.jobRegistry(), jobRegistry.address, 'dispute.jobRegistry');
    expectEq(await reputation.jobRegistry(), jobRegistry.address, 'reputation.jobRegistry');

    const stakeToken = await staking.stakeToken();
    const stakeDecimals = Number(await staking.stakeTokenDecimals());
    const feeToken = await feePool.feeToken();
    const feeBurnAddress = await feePool.burnAddress();

    const tokenMetadata = await fetchTokenMetadata(stakeToken);
    const descriptor = [];
    if (tokenMetadata.name) {
      descriptor.push(tokenMetadata.name);
    }
    if (tokenMetadata.symbol) {
      descriptor.push(`(${tokenMetadata.symbol})`);
    }
    if (descriptor.length > 0) {
      console.log(`Stake token metadata: ${descriptor.join(' ')}`);
    } else {
      console.log('Stake token metadata: (symbol/name unavailable)');
    }

    if (tokenMetadata.decimals !== null && tokenMetadata.decimals !== stakeDecimals) {
      throw new Error(
        `Stake token decimals mismatch: StakeManager stored ${stakeDecimals} but token at ${stakeToken} reports ${tokenMetadata.decimals}`
      );
    }

    if (agiCfg) {
      const expectedSymbol = normalizeString(agiCfg.symbol);
      const expectedName = normalizeString(agiCfg.name);

      if (agiCfg.token && typeof agiCfg.token === 'string' && agiCfg.token !== 'mock') {
        expectEq(stakeToken, agiCfg.token, 'staking.stakeToken');
        expectEq(feeToken, agiCfg.token, 'feePool.feeToken');
      } else {
        expectEq(feeToken, stakeToken, 'feePool.feeToken matches stakeToken');
      }

      if (agiCfg.decimals !== undefined && agiCfg.decimals !== null) {
        const expectedDecimals = Number(agiCfg.decimals);
        if (stakeDecimals !== expectedDecimals) {
          throw new Error(
            `Stake token decimals mismatch: expected ${expectedDecimals} but found ${stakeDecimals}`
          );
        }
      }

      if (agiCfg.burnAddress) {
        expectEq(feeBurnAddress, agiCfg.burnAddress, 'feePool.burnAddress');
      }

      if (expectedSymbol) {
        const actualSymbol = normalizeString(tokenMetadata.symbol);
        if (!actualSymbol) {
          throw new Error(
            `Stake token at ${stakeToken} did not return a symbol but ${expectedSymbol} was configured`
          );
        }
        if (actualSymbol !== expectedSymbol) {
          throw new Error(
            `Stake token symbol mismatch: expected "${expectedSymbol}" but token reported "${actualSymbol}"`
          );
        }
      }

      if (expectedName) {
        const actualName = normalizeString(tokenMetadata.name);
        if (!actualName) {
          throw new Error(
            `Stake token at ${stakeToken} did not return a name but ${expectedName} was configured`
          );
        }
        if (actualName !== expectedName) {
          throw new Error(
            `Stake token name mismatch: expected "${expectedName}" but token reported "${actualName}"`
          );
        }
      }
    }

    if (hasEnsConfig) {
      const onChainRegistry = await identity.ensRegistry();
      const onChainAgentHash = await identity.agentRootHash();
      const onChainClubHash = await identity.clubRootHash();

      const configuredAgentHash = typeof ensCfg.agentRootHash === 'string' ? ensCfg.agentRootHash : null;
      const configuredClubHash = typeof ensCfg.clubRootHash === 'string' ? ensCfg.clubRootHash : null;

      let agentRootHashForChecks = configuredAgentHash;
      if (normalizedAgentRootName) {
        if (!configuredAgentHash) {
          throw new Error('config.ens.agentRootHash must be set when config.ens.agentRoot is provided');
        }
        if (configuredAgentHash.toLowerCase() === ZERO_NAMEHASH) {
          throw new Error('config.ens.agentRootHash must not be the zero namehash');
        }
        const derivedAgentHash = computeNamehash(normalizedAgentRootName);
        expectEq(
          configuredAgentHash,
          derivedAgentHash,
          'config.ens.agentRootHash matches namehash(config.ens.agentRoot)'
        );
        agentRootHashForChecks = derivedAgentHash;
      } else if (configuredAgentHash) {
        throw new Error('config.ens.agentRoot must be specified when config.ens.agentRootHash is set');
      }

      let clubRootHashForChecks = configuredClubHash;
      if (normalizedClubRootName) {
        if (!configuredClubHash) {
          throw new Error('config.ens.clubRootHash must be set when config.ens.clubRoot is provided');
        }
        if (configuredClubHash.toLowerCase() === ZERO_NAMEHASH) {
          throw new Error('config.ens.clubRootHash must not be the zero namehash');
        }
        const derivedClubHash = computeNamehash(normalizedClubRootName);
        expectEq(
          configuredClubHash,
          derivedClubHash,
          'config.ens.clubRootHash matches namehash(config.ens.clubRoot)'
        );
        clubRootHashForChecks = derivedClubHash;
      } else if (configuredClubHash) {
        throw new Error('config.ens.clubRoot must be specified when config.ens.clubRootHash is set');
      }

      const hasConfiguredRoots = Boolean(agentRootHashForChecks && clubRootHashForChecks);

      if (ensCfg.registry && hasConfiguredRoots) {
        expectEq(onChainRegistry, ensCfg.registry, 'identity.ensRegistry');
      } else if (ensCfg.registry && onChainRegistry.toLowerCase() !== ZERO_ADDRESS) {
        expectEq(onChainRegistry, ensCfg.registry, 'identity.ensRegistry');
      }

      if (agentRootHashForChecks) {
        expectEq(onChainAgentHash, agentRootHashForChecks, 'identity.agentRootHash');
      }

      if (clubRootHashForChecks) {
        expectEq(onChainClubHash, clubRootHashForChecks, 'identity.clubRootHash');
      }

      const wrapperAddress = normalizeString(ensCfg.nameWrapper);
      if (wrapperAddress && wrapperAddress !== ZERO_ADDRESS) {
        const code = await web3.eth.getCode(wrapperAddress);
        if (!code || code === '0x') {
          throw new Error(`ENS NameWrapper at ${wrapperAddress} has no bytecode`);
        }

        try {
          const nameWrapperContract = new web3.eth.Contract(NAME_WRAPPER_ABI, wrapperAddress);
          const wrapperRegistry = await nameWrapperContract.methods.ens().call();
          if (ensCfg.registry) {
            expectEq(wrapperRegistry, ensCfg.registry, 'nameWrapper.ens');
          }

          if (ensCfg.registry && ensCfg.registry.toLowerCase() !== ZERO_ADDRESS) {
            const registryContract = new web3.eth.Contract(ENS_REGISTRY_ABI, ensCfg.registry);
            const nodesToCheck = [
              ['agent root', agentRootHashForChecks, normalizedAgentRootName],
              ['club root', clubRootHashForChecks, normalizedClubRootName],
            ].filter(([, nodeHash]) => Boolean(nodeHash));

            await Promise.all(
              nodesToCheck.map(async ([label, nodeHash, humanName]) => {
                const [owner, exists] = await Promise.all([
                  registryContract.methods.owner(nodeHash).call(),
                  registryContract.methods
                    .recordExists(nodeHash)
                    .call()
                    .catch(() => null),
                ]);

                if (!owner || owner.toLowerCase() === ZERO_ADDRESS) {
                  const descriptor = humanName || nodeHash;
                  throw new Error(`ENS registry owner for ${label} ${descriptor} is unset`);
                }

                expectEq(owner, wrapperAddress, `ENS NameWrapper must own the ${label}`);

                if (exists === false) {
                  const descriptor = humanName || nodeHash;
                  throw new Error(`ENS registry reports no record for ${label} ${descriptor}`);
                }
              })
            );
          }
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          throw new Error(`Failed to query ENS NameWrapper at ${wrapperAddress}: ${message}`);
        }
      }
    }

    const thresholds = await jobRegistry.thresholds();
    if (Number(thresholds.feeBps) !== params.feeBps) {
      throw new Error('feeBps mismatch');
    }
    if (Number(thresholds.slashBpsMax) !== params.slashBpsMax) {
      throw new Error('slashBpsMax mismatch');
    }
    if (Number(thresholds.approvalThresholdBps) !== params.approvalThresholdBps) {
      throw new Error('approvalThresholdBps mismatch');
    }
    if (Number(thresholds.quorumMin) !== params.quorumMin) {
      throw new Error('quorumMin mismatch');
    }
    if (Number(thresholds.quorumMax) !== params.quorumMax) {
      throw new Error('quorumMax mismatch');
    }

    const timings = await jobRegistry.timings();
    if (Number(timings.commitWindow) !== params.commitWindow) {
      throw new Error('commitWindow mismatch');
    }
    if (Number(timings.revealWindow) !== params.revealWindow) {
      throw new Error('revealWindow mismatch');
    }
    if (Number(timings.disputeWindow) !== params.disputeWindow) {
      throw new Error('disputeWindow mismatch');
    }

    console.log('WIRING OK');
    callback();
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
    callback(err);
  }
};
