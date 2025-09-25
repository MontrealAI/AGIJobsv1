'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readConfig, resolveVariant, SUPPORTED_VARIANTS } = require('../config-loader');

const REQUIRED_ENV = [
  {
    name: 'MNEMONIC',
    description: 'Deployer wallet 12/24 word mnemonic (read from .env in production workflows)',
  },
  {
    name: 'RPC_MAINNET',
    description: 'HTTPS RPC endpoint for Ethereum mainnet (e.g. Infura, Alchemy, QuickNode)',
  },
  {
    name: 'GOV_SAFE',
    description: 'Multisig address that will become owner of all protocol contracts',
  },
];

const OPTIONAL_ENV = [
  {
    name: 'TIMELOCK_ADDR',
    description:
      'Optional timelock/operations contract with admin rights (owner retains emergency control if omitted)',
    validator: (value) => isAddress(value) || fail(`TIMELOCK_ADDR must be a valid Ethereum address`),
  },
  {
    name: 'ETHERSCAN_API_KEY',
    description: 'API key used for post-deployment source verification',
  },
  {
    name: 'RPC_SEPOLIA',
    description: 'Sepolia RPC used in rehearsals (recommended before mainnet launch)',
  },
];

function fail(message) {
  throw new Error(message);
}

function isAddress(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function checkEnvironment() {
  console.log('🧪 Environment preflight checks');
  let missing = false;

  for (const { name, description } of REQUIRED_ENV) {
    const value = process.env[name];
    if (!value || String(value).trim().length === 0) {
      console.log(`  ✖ ${name} is missing — ${description}`);
      missing = true;
    } else {
      if (name.endsWith('_MAINNET') && !String(value).startsWith('https://')) {
        console.log(`  ⚠ ${name} does not appear to be an HTTPS endpoint. Double-check the value.`);
      } else {
        console.log(`  ✔ ${name} loaded`);
      }
    }
  }

  for (const { name, description, validator } of OPTIONAL_ENV) {
    const value = process.env[name];
    if (!value || String(value).trim().length === 0) {
      console.log(`  • ${name} not set (${description})`);
      continue;
    }
    try {
      if (validator) {
        validator(value);
      }
      console.log(`  ✔ ${name} looks good`);
    } catch (error) {
      console.log(`  ✖ ${name} invalid — ${error.message}`);
      missing = true;
    }
  }

  if (missing) {
    fail('Resolve the configuration issues above before deploying.');
  }
}

function loadConfig(configName, network) {
  try {
    return readConfig(configName, network);
  } catch (error) {
    fail(`Unable to read config ${configName} for ${network}: ${error.message}`);
  }
  return null;
}

function loadParamsConfig() {
  const filePath = path.join(__dirname, '..', '..', 'config', 'params.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    fail(`Unable to read config params.json: ${error.message}`);
  }
  return null;
}

function summarizeConfig(network) {
  console.log('\n📦 Configuration snapshot');
  const agi = loadConfig('agialpha', network);
  const ens = loadConfig('ens', network);
  const registrar = loadConfig('registrar', network);
  const params = loadParamsConfig();

  console.log(`  • Staking token: ${agi.token}`);
  console.log(`  • Token decimals: ${agi.decimals}`);
  console.log(`  • Fee burn address: ${agi.burnAddress}`);
  console.log(`  • ENS registry: ${ens.registry}`);
  console.log(`  • ENS name wrapper: ${ens.nameWrapper || 'not configured'}`);
  console.log(`  • Agent ENS root: ${ens.agentRootHash || 'not set'}`);
  console.log(`  • Club ENS root: ${ens.clubRootHash || 'not set'}`);
  console.log(`  • Registrar target: ${registrar.target || 'n/a'}`);
  console.log(
    `  • Job timings (seconds): commit=${params.commitWindow}, reveal=${params.revealWindow}, dispute=${params.disputeWindow}`,
  );
  console.log(
    `  • Thresholds: approval=${params.approvalThresholdBps}bps, quorum=${params.quorumMin}-${params.quorumMax}, fee=${params.feeBps}bps, slashMax=${params.slashBpsMax}bps`,
  );
}

function runConfigValidation(network) {
  console.log('\n🔍 Validating configuration via scripts/validate-config.js');
  const validationScript = path.join(__dirname, '..', 'validate-config.js');
  const result = spawnSync('node', [validationScript], {
    stdio: 'inherit',
    env: { ...process.env, CONFIG_VARIANT: network },
  });
  if (result.status !== 0) {
    fail('Configuration validation failed. Review errors above before proceeding.');
  }
}

function printExecutionPlan(network) {
  console.log('\n🚀 Recommended execution plan');
  console.log('  1. npm install --production=false');
  console.log('  2. npm run build');
  console.log(`  3. npm run config:validate (CONFIG_VARIANT=${network})`);
  console.log('  4. npm run migrate:sepolia (optional mainnet rehearsal)');
  console.log('  5. npm run migrate:mainnet');
  console.log('  6. npm run verify:mainnet (after block confirmations)');
  console.log('  7. npm run wire:verify -- NETWORK=mainnet');
  console.log('  8. npm run owner:wizard -- NETWORK=mainnet (post-deploy governance review)');
  console.log('  9. Document governance decisions and archive deployment artifacts.');
}

function describePostDeploymentControls() {
  console.log('\n🔐 Owner control surface overview');
  console.log('  • JobRegistry.setModules / updateModule — swap subsystem implementations.');
  console.log('  • JobRegistry.setTimings / updateTiming — change commit/reveal/dispute windows.');
  console.log('  • JobRegistry.setThresholds / updateThreshold — tune quorum, fees, and slashing.');
  console.log('  • JobRegistry.extendJobDeadlines — extend deadlines for active jobs.');
  console.log('  • StakeManager.updateJobRegistry / setFeeRecipient — migrate registry or fee sink.');
  console.log('  • FeePool.updateJobRegistry — redirect fee accounting to a new registry.');
  console.log('  • IdentityRegistry (configureEns) — update ENS integration.');
  console.log('  Use npm run owner:console or npm run owner:wizard for guided transactions.');
}

function main() {
  const variantArg = process.argv[2];
  const variant = resolveVariant(variantArg || 'mainnet');
  if (variant !== 'mainnet') {
    console.log(`ℹ Using ${variant} variant. Supported variants: ${SUPPORTED_VARIANTS.join(', ')}`);
  }

  checkEnvironment();
  summarizeConfig(variant);
  runConfigValidation(variant);
  printExecutionPlan(variant);
  describePostDeploymentControls();

  console.log('\n✅ Checklist complete. Proceed with deployment when ready.');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`\nDeployment checklist failed: ${error.message}`);
    process.exitCode = 1;
  }
}
