'use strict';

const { MODULE_KEYS } = require('./job-registry-configurator');

const MODULE_ARTIFACT_NAMES = {
  identity: 'IdentityRegistry',
  staking: 'StakeManager',
  validation: 'ValidationModule',
  dispute: 'DisputeModule',
  reputation: 'ReputationEngine',
  feePool: 'FeePool',
};

function resolveArtifacts() {
  if (typeof artifacts === 'undefined' || !artifacts || typeof artifacts.require !== 'function') {
    throw new Error(
      'Truffle artifacts are not available. Ensure @nomiclabs/hardhat-truffle5 is loaded before resolving module defaults.'
    );
  }

  return MODULE_ARTIFACT_NAMES;
}

function getArtifactByKey(key) {
  const mapping = resolveArtifacts();
  const name = mapping[key];
  if (!name) {
    return null;
  }
  return artifacts.require(name);
}

async function resolveModuleDefaults(overrides) {
  const defaults = {};

  for (const key of MODULE_KEYS) {
    if (overrides[key] !== undefined && overrides[key] !== null) {
      continue;
    }

    const artifact = getArtifactByKey(key);
    if (!artifact) {
      continue;
    }

    try {
      const instance = await artifact.deployed();
      defaults[key] = instance.address;
    } catch (error) {
      throw new Error(
        `Unable to determine default deployment for modules.${key}. Provide an explicit override with --modules.${key}.`
      );
    }
  }

  return defaults;
}

module.exports = {
  MODULE_ARTIFACT_NAMES,
  resolveModuleDefaults,
};
