'use strict';

const IdentityRegistry = artifacts.require('IdentityRegistry');
const StakeManager = artifacts.require('StakeManager');
const ValidationModule = artifacts.require('ValidationModule');
const DisputeModule = artifacts.require('DisputeModule');
const ReputationEngine = artifacts.require('ReputationEngine');
const FeePool = artifacts.require('FeePool');

const { MODULE_KEYS } = require('./job-registry-configurator');

const MODULE_ARTIFACTS = {
  identity: IdentityRegistry,
  staking: StakeManager,
  validation: ValidationModule,
  dispute: DisputeModule,
  reputation: ReputationEngine,
  feePool: FeePool,
};

async function resolveModuleDefaults(overrides) {
  const defaults = {};

  for (const key of MODULE_KEYS) {
    if (overrides[key] !== undefined && overrides[key] !== null) {
      continue;
    }

    const artifact = MODULE_ARTIFACTS[key];
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
  MODULE_ARTIFACTS,
  resolveModuleDefaults,
};
