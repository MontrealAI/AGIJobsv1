#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Web3 = require('web3');

const ADDRESS_MANIFEST =
  process.env.JOB_REGISTRY_ADDRESS_FILE ||
  path.join(__dirname, '..', 'artifacts-public', 'addresses', 'mainnet.json');
const ABI_MANIFEST =
  process.env.JOB_REGISTRY_ABI_FILE ||
  path.join(__dirname, '..', 'artifacts-public', 'abis', 'JobRegistry.json');
const JOB_REGISTRY_ADDRESS =
  process.env.JOB_REGISTRY_ADDRESS || require(ADDRESS_MANIFEST).JobRegistry;
const JOB_REGISTRY_ABI = require(ABI_MANIFEST).abi;
const HTTP_RPC_URL =
  process.env.JOB_REGISTRY_HTTP || process.env.JOB_REGISTRY_RPC || 'http://127.0.0.1:8545';
const WS_RPC_URL =
  process.env.JOB_REGISTRY_WS || process.env.JOB_REGISTRY_WSS || HTTP_RPC_URL.replace('http', 'ws');
const PRIVATE_KEY = process.env.WORKER_PRIVATE_KEY || process.env.PRIVATE_KEY;
const STORE_PATH = process.env.JOB_COMMIT_STORE || path.join(__dirname, '.commit-secrets.json');

const HELP = `Usage: node v2-agent-gateway.js <command> [...args]

Commands:
  watch                         Subscribe to JobCreated events.
  commit <jobId>                Commit to a job and persist the reveal secret locally.
  reveal <jobId>                Reveal a previously committed job.
  finalize <jobId> <success>    Finalize a revealed job (governance-only).

Environment:
  JOB_REGISTRY_RPC / JOB_REGISTRY_HTTP    HTTP JSON-RPC endpoint (default http://127.0.0.1:8545).
  JOB_REGISTRY_WS / JOB_REGISTRY_WSS      WebSocket endpoint for event subscriptions.
  JOB_REGISTRY_ADDRESS_FILE               Override addresses manifest (defaults to mainnet addresses).
  JOB_REGISTRY_ABI_FILE                   Override ABI path.
  JOB_REGISTRY_ADDRESS                    Override JobRegistry address (takes precedence over manifest).
  WORKER_PRIVATE_KEY / PRIVATE_KEY        Private key for the committing account (0x-prefixed hex).
  JOB_COMMIT_STORE                        Override path for the local commit secret store.
`;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  switch ((command || '').toLowerCase()) {
    case 'watch':
      return watchJobs();
    case 'commit':
      return commitToJob(args);
    case 'reveal':
      return revealJob(args);
    case 'finalize':
      return finalizeJob(args);
    default:
      process.stdout.write(HELP);
      if (!command) {
        process.exit(0);
      }
      process.exit(1);
  }
}

function createHttpClient() {
  const web3 = new Web3(HTTP_RPC_URL);
  web3.eth.handleRevert = true;
  return web3;
}

function requireAccount(web3) {
  if (!PRIVATE_KEY) {
    throw new Error('Set WORKER_PRIVATE_KEY before sending transactions.');
  }
  const normalized = PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : `0x${PRIVATE_KEY}`;
  const account = web3.eth.accounts.privateKeyToAccount(normalized);
  web3.eth.accounts.wallet.add(account);
  web3.eth.defaultAccount = account.address;
  return account;
}

function getContract(web3) {
  return new web3.eth.Contract(JOB_REGISTRY_ABI, JOB_REGISTRY_ADDRESS);
}

function loadStore() {
  if (!fs.existsSync(STORE_PATH)) {
    return {};
  }
  const raw = fs.readFileSync(STORE_PATH, 'utf8');
  return raw.trim() ? JSON.parse(raw) : {};
}

function saveStore(store) {
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`);
}

async function watchJobs() {
  const provider = new Web3.providers.WebsocketProvider(WS_RPC_URL, {
    reconnect: {
      auto: true,
      delay: 2000,
      maxAttempts: 10,
      onTimeout: false,
    },
  });
  const web3 = new Web3(provider);
  web3.eth.handleRevert = true;
  const registry = getContract(web3);

  process.stdout.write(`Watching JobRegistry @ ${JOB_REGISTRY_ADDRESS} on ${WS_RPC_URL}\n`);

  registry.events
    .JobCreated({})
    .on('connected', (subId) => {
      process.stdout.write(`Subscribed to JobCreated (subscription id ${subId}).\n`);
    })
    .on('data', (event) => {
      const { jobId, client, stakeAmount } = event.returnValues;
      process.stdout.write(
        `JobCreated => id=${jobId} client=${client} stake=${web3.utils.fromWei(stakeAmount)} ETH\n`
      );
    })
    .on('error', (err) => {
      process.stderr.write(`JobCreated subscription error: ${err.message}\n`);
    });

  process.on('SIGINT', () => {
    process.stdout.write('\nShutting down watcher...\n');
    provider.disconnect(1000, 'agent shutdown');
    process.exit(0);
  });
}

async function commitToJob(args) {
  if (!args[0]) {
    throw new Error('commit requires a jobId argument');
  }
  const jobId = web3SafeNumber(args[0]);
  const web3 = createHttpClient();
  const account = requireAccount(web3);
  const registry = getContract(web3);

  const secret = `0x${crypto.randomBytes(32).toString('hex')}`;
  const commitHash = web3.utils.soliditySha3({ type: 'bytes32', value: secret });

  process.stdout.write(
    `Committing to job ${jobId} from ${account.address} (commitHash ${commitHash}).\n`
  );

  await registry.methods.commitJob(jobId, commitHash).send({
    from: account.address,
    gas: 500000,
  });

  const store = loadStore();
  store[jobId] = secret;
  saveStore(store);
  process.stdout.write(`Stored reveal secret for job ${jobId} in ${STORE_PATH}.\n`);
}

async function revealJob(args) {
  if (!args[0]) {
    throw new Error('reveal requires a jobId argument');
  }
  const jobId = web3SafeNumber(args[0]);
  const store = loadStore();
  const secret = store[jobId];
  if (!secret) {
    throw new Error(`No stored secret for job ${jobId}. Did you commit first?`);
  }

  const web3 = createHttpClient();
  const account = requireAccount(web3);
  const registry = getContract(web3);

  process.stdout.write(`Revealing job ${jobId} from ${account.address}.\n`);

  await registry.methods.revealJob(jobId, secret).send({
    from: account.address,
    gas: 400000,
  });

  delete store[jobId];
  saveStore(store);
  process.stdout.write(`Reveal complete. Secret cleared from ${STORE_PATH}.\n`);
}

async function finalizeJob(args) {
  if (!args[0] || typeof args[1] === 'undefined') {
    throw new Error('finalize requires <jobId> and <success> arguments');
  }
  const jobId = web3SafeNumber(args[0]);
  const successFlag = parseBoolean(args[1]);
  const web3 = createHttpClient();
  const account = requireAccount(web3);
  const registry = getContract(web3);

  process.stdout.write(
    `Finalizing job ${jobId} with success=${successFlag} from ${account.address}.\n`
  );

  await registry.methods.finalizeJob(jobId, successFlag).send({
    from: account.address,
    gas: 400000,
  });

  process.stdout.write('Finalize transaction broadcast.\n');
}

function parseBoolean(value) {
  const normalized = String(value).toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n'].includes(normalized)) {
    return false;
  }
  throw new Error(`Cannot parse boolean flag from '${value}'. Use true/false.`);
}

function web3SafeNumber(value) {
  if (!/^\d+$/.test(String(value))) {
    throw new Error(`Invalid numeric argument '${value}'.`);
  }
  return String(value);
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
