#!/usr/bin/env node

const path = require('path');
const Web3 = require('web3');

const DEFAULT_ADDRESS_MANIFEST = path.join(
  __dirname,
  '..',
  'artifacts-public',
  'addresses',
  'mainnet.json'
);
const DEFAULT_ABI_DIR = path.join(__dirname, '..', 'artifacts-public', 'abis');

const jobRegistryAddressManifestPath =
  process.env.JOB_REGISTRY_ADDRESS_FILE || DEFAULT_ADDRESS_MANIFEST;
const validationAddressManifestPath =
  process.env.VALIDATION_MODULE_ADDRESS_FILE || jobRegistryAddressManifestPath;

const jobRegistryAddresses = loadJson(
  jobRegistryAddressManifestPath,
  'JobRegistry address manifest'
);
const validationAddresses =
  validationAddressManifestPath === jobRegistryAddressManifestPath
    ? jobRegistryAddresses
    : loadJson(validationAddressManifestPath, 'ValidationModule address manifest');

const JOB_REGISTRY_ADDRESS = process.env.JOB_REGISTRY_ADDRESS || jobRegistryAddresses.JobRegistry;
const VALIDATION_MODULE_ADDRESS =
  process.env.VALIDATION_MODULE_ADDRESS || validationAddresses.ValidationModule;

const JOB_REGISTRY_ABI_PATH =
  process.env.JOB_REGISTRY_ABI_FILE || path.join(DEFAULT_ABI_DIR, 'JobRegistry.json');
const VALIDATION_MODULE_ABI_PATH =
  process.env.VALIDATION_MODULE_ABI_FILE || path.join(DEFAULT_ABI_DIR, 'ValidationModule.json');

const JOB_REGISTRY_ABI = loadJson(JOB_REGISTRY_ABI_PATH, 'JobRegistry ABI').abi;
const VALIDATION_MODULE_ABI = loadJson(VALIDATION_MODULE_ABI_PATH, 'ValidationModule ABI').abi;

const HTTP_RPC_URL =
  process.env.JOB_REGISTRY_HTTP || process.env.JOB_REGISTRY_RPC || 'http://127.0.0.1:8545';
const WS_RPC_URL =
  process.env.JOB_REGISTRY_WS || process.env.JOB_REGISTRY_WSS || HTTP_RPC_URL.replace('http', 'ws');
const PRIVATE_KEY = process.env.VALIDATOR_PRIVATE_KEY || process.env.PRIVATE_KEY;

const JOB_STATE_LABELS = ['None', 'Created', 'Committed', 'Revealed', 'Finalized', 'Disputed'];
const WATCHED_EVENTS = [
  'JobCreated',
  'JobCommitted',
  'JobRevealed',
  'JobFinalized',
  'JobDisputed',
  'DisputeResolved',
  'JobTimedOut',
];

const HELP = `Usage: node v2-validator.js <command> [...args]

Commands:
  watch                                  Subscribe to JobRegistry lifecycle events (commit/reveal/dispute).
  poll <jobId>                           Print the current job state from JobRegistry.
  rule:set <rule> <enabled>              Toggle a validation rule (hash string identifiers automatically).
  rule:status <rule>                     Query whether a validation rule is enabled.

Environment:
  JOB_REGISTRY_RPC / JOB_REGISTRY_HTTP   HTTP JSON-RPC endpoint (default http://127.0.0.1:8545).
  JOB_REGISTRY_WS / JOB_REGISTRY_WSS     WebSocket endpoint for lifecycle subscriptions.
  JOB_REGISTRY_ADDRESS_FILE              Override JobRegistry addresses manifest (defaults to mainnet addresses).
  JOB_REGISTRY_ABI_FILE                  Override JobRegistry ABI path.
  JOB_REGISTRY_ADDRESS                   Override JobRegistry address (takes precedence over manifest).
  VALIDATION_MODULE_ADDRESS_FILE         Override ValidationModule addresses manifest.
  VALIDATION_MODULE_ABI_FILE             Override ValidationModule ABI path.
  VALIDATION_MODULE_ADDRESS              Override ValidationModule address (takes precedence over manifest).
  VALIDATOR_PRIVATE_KEY / PRIVATE_KEY    Private key for on-chain transactions (0x-prefixed hex).
`;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const normalized = (command || '').toLowerCase();

  try {
    switch (normalized) {
      case 'watch':
        await watchLifecycle();
        return;
      case 'poll':
        await pollJob(args);
        return;
      case 'rule:set':
        await setValidationRule(args);
        return;
      case 'rule:status':
        await queryValidationRule(args);
        return;
      case '--help':
      case '-h':
      case 'help':
        process.stdout.write(HELP);
        return;
      case '':
        process.stdout.write(HELP);
        return;
      default:
        process.stderr.write(`Unknown command '${command}'.\n\n`);
        process.stdout.write(HELP);
        process.exitCode = 1;
    }
  } catch (error) {
    process.exitCode = 1;
    process.stderr.write(`${error.message || error}\n`);
  }
}

function loadJson(filePath, label) {
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    return require(filePath);
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' || error.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error(`Unable to load ${label} from ${filePath}`);
    }
    throw error;
  }
}

function createHttpClient() {
  const web3 = new Web3(HTTP_RPC_URL);
  web3.eth.handleRevert = true;
  return web3;
}

function createWsClient() {
  const provider = new Web3.providers.WebsocketProvider(WS_RPC_URL, {
    clientConfig: {
      keepalive: true,
      keepaliveInterval: 60_000,
    },
    reconnect: {
      auto: true,
      delay: 1000,
      maxAttempts: 5,
      onTimeout: false,
    },
  });

  const web3 = new Web3(provider);
  return web3;
}

function requireAccount(web3) {
  if (!PRIVATE_KEY) {
    throw new Error('Set VALIDATOR_PRIVATE_KEY (or PRIVATE_KEY) before sending transactions.');
  }
  const normalized = PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : `0x${PRIVATE_KEY}`;
  const account = web3.eth.accounts.privateKeyToAccount(normalized);
  web3.eth.accounts.wallet.add(account);
  web3.eth.defaultAccount = account.address;
  return account;
}

function getJobRegistryContract(web3) {
  if (!JOB_REGISTRY_ADDRESS) {
    throw new Error(
      'JobRegistry address not configured. Set JOB_REGISTRY_ADDRESS or provide a manifest.'
    );
  }
  return new web3.eth.Contract(JOB_REGISTRY_ABI, JOB_REGISTRY_ADDRESS);
}

function getValidationModuleContract(web3) {
  if (!VALIDATION_MODULE_ADDRESS) {
    throw new Error(
      'ValidationModule address not configured. Set VALIDATION_MODULE_ADDRESS or provide a manifest.'
    );
  }
  return new web3.eth.Contract(VALIDATION_MODULE_ABI, VALIDATION_MODULE_ADDRESS);
}

function parseJobId(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error('Job ID argument required.');
  }
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`Invalid job ID '${value}'.`);
  }
  return normalized;
}

function parseBoolean(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    throw new Error('Boolean flag required (true/false).');
  }
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean flag '${value}'. Expected true/false.`);
}

function normalizeRule(ruleInput, web3) {
  const normalized = String(ruleInput || '').trim();
  if (!normalized) {
    throw new Error('Validation rule identifier required.');
  }
  if (/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    return { hash: normalized, description: null };
  }

  const hash = web3.utils.keccak256(normalized);
  return { hash, description: `keccak256('${normalized}')` };
}

function describeEvent(event) {
  const { event: name, returnValues, blockNumber, transactionHash } = event;
  const details = Object.entries(returnValues)
    .filter(([key]) => Number.isNaN(Number(key)))
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
  const scope = blockNumber ? `block ${blockNumber}` : 'pending';
  const tx = transactionHash ? ` tx=${transactionHash}` : '';
  process.stdout.write(`[${name}] ${details || '(no fields)'} (${scope})${tx}\n`);
}

async function watchLifecycle() {
  const web3 = createWsClient();
  const registry = getJobRegistryContract(web3);
  process.stdout.write(`Watching JobRegistry at ${JOB_REGISTRY_ADDRESS} — press Ctrl+C to exit.\n`);

  const subscriptions = WATCHED_EVENTS.map((eventName) =>
    registry.events[eventName]({}, (error) => {
      if (error) {
        process.stderr.write(`Subscription error for ${eventName}: ${error.message || error}\n`);
      }
    })
      .on('data', describeEvent)
      .on('error', (error) => {
        process.stderr.write(`Event stream error for ${eventName}: ${error.message || error}\n`);
      })
  );

  const cleanup = () => {
    subscriptions.forEach((subscription) => {
      if (subscription && typeof subscription.unsubscribe === 'function') {
        try {
          subscription.unsubscribe();
        } catch (_) {
          // ignore
        }
      }
    });
    const provider = web3.currentProvider;
    if (provider && typeof provider.disconnect === 'function') {
      try {
        provider.disconnect(1000, 'shutdown');
      } catch (_) {
        // ignore
      }
    }
  };

  const exit = (signal) => {
    process.stdout.write(`Received ${signal}. Closing subscriptions...\n`);
    cleanup();
    process.exit(0);
  };

  process.once('SIGINT', () => exit('SIGINT'));
  process.once('SIGTERM', () => exit('SIGTERM'));
}

async function pollJob(args) {
  const jobId = parseJobId(args[0]);
  const web3 = createHttpClient();
  const registry = getJobRegistryContract(web3);
  const job = await registry.methods.jobs(jobId).call();

  const stateIndex = Number(job.state);
  const state =
    Number.isInteger(stateIndex) && JOB_STATE_LABELS[stateIndex]
      ? JOB_STATE_LABELS[stateIndex]
      : `Unknown(${job.state})`;

  const result = {
    jobId,
    state,
    client: job.client,
    worker: job.worker,
    stakeAmount: job.stakeAmount,
    commitDeadline: job.commitDeadline,
    revealDeadline: job.revealDeadline,
    disputeDeadline: job.disputeDeadline,
    commitHash: job.commitHash,
  };

  if (result.client === '0x0000000000000000000000000000000000000000' && stateIndex === 0) {
    process.stderr.write(`Job ${jobId} has not been created yet.\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function setValidationRule(args) {
  const [ruleInput, enabledInput] = args;
  const web3 = createHttpClient();
  const account = requireAccount(web3);
  const validation = getValidationModuleContract(web3);

  const { hash, description } = normalizeRule(ruleInput, web3);
  const enabled = parseBoolean(enabledInput);

  const descriptor = description ? `${hash} (${description})` : hash;
  process.stdout.write(
    `Sending setValidationRule(${descriptor}, ${enabled}) from ${account.address}...\n`
  );

  const receipt = await validation.methods
    .setValidationRule(hash, enabled)
    .send({ from: account.address });

  process.stdout.write(`Tx hash: ${receipt.transactionHash}\n`);
}

async function queryValidationRule(args) {
  const [ruleInput] = args;
  const web3 = createHttpClient();
  const validation = getValidationModuleContract(web3);
  const { hash, description } = normalizeRule(ruleInput, web3);
  const enabled = await validation.methods.validationRules(hash).call();
  const descriptor = description ? `${hash} (${description})` : hash;
  process.stdout.write(`Rule ${descriptor} enabled: ${Boolean(enabled)}\n`);
}

main();
