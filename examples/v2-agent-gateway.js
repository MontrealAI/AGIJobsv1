#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Web3 = require('web3');

const DEFAULT_ADDRESS_MANIFEST = path.join(
  __dirname,
  '..',
  'artifacts-public',
  'addresses',
  'mainnet.json'
);
const jobRegistryAddressManifestPath =
  process.env.JOB_REGISTRY_ADDRESS_FILE || DEFAULT_ADDRESS_MANIFEST;
const stakeManagerAddressManifestPath =
  process.env.STAKE_MANAGER_ADDRESS_FILE || jobRegistryAddressManifestPath;
const jobRegistryAddresses = require(jobRegistryAddressManifestPath);
const stakeManagerAddresses =
  stakeManagerAddressManifestPath === jobRegistryAddressManifestPath
    ? jobRegistryAddresses
    : require(stakeManagerAddressManifestPath);
const DEFAULT_ABI_DIR = path.join(__dirname, '..', 'artifacts-public', 'abis');
const JOB_REGISTRY_ABI_PATH =
  process.env.JOB_REGISTRY_ABI_FILE || path.join(DEFAULT_ABI_DIR, 'JobRegistry.json');
const STAKE_MANAGER_ABI_PATH =
  process.env.STAKE_MANAGER_ABI_FILE || path.join(DEFAULT_ABI_DIR, 'StakeManager.json');
const STAKE_TOKEN_ABI_PATH =
  process.env.STAKE_TOKEN_ABI_FILE || path.join(DEFAULT_ABI_DIR, 'IERC20.json');
const JOB_REGISTRY_ADDRESS = process.env.JOB_REGISTRY_ADDRESS || jobRegistryAddresses.JobRegistry;
const STAKE_MANAGER_ADDRESS =
  process.env.STAKE_MANAGER_ADDRESS || stakeManagerAddresses.StakeManager;
const JOB_REGISTRY_ABI = require(JOB_REGISTRY_ABI_PATH).abi;
const STAKE_MANAGER_ABI = require(STAKE_MANAGER_ABI_PATH).abi;
const ERC20_ABI = require(STAKE_TOKEN_ABI_PATH).abi;
const HTTP_RPC_URL =
  process.env.JOB_REGISTRY_HTTP || process.env.JOB_REGISTRY_RPC || 'http://127.0.0.1:8545';
const WS_RPC_URL =
  process.env.JOB_REGISTRY_WS || process.env.JOB_REGISTRY_WSS || HTTP_RPC_URL.replace('http', 'ws');
const PRIVATE_KEY = process.env.WORKER_PRIVATE_KEY || process.env.PRIVATE_KEY;
const STORE_PATH = process.env.JOB_COMMIT_STORE || path.join(__dirname, '.commit-secrets.json');
const REQUIRED_STAKE =
  process.env.WORKER_REQUIRED_STAKE || process.env.AGENT_REQUIRED_STAKE || null;

const HELP = `Usage: node v2-agent-gateway.js <command> [...args]

Commands:
  watch                               Subscribe to JobCreated events.
  commit <jobId>                      Commit to a job and persist the reveal secret locally.
  reveal <jobId>                      Reveal a previously committed job.
  finalize <jobId> <success>          Finalize a revealed job (governance-only).
  stake:status                        Display total deposits, locked stake, and available stake.
  stake:deposit <amount>              Approve (if needed) and deposit stake tokens in decimal units.
  stake:withdraw <amount>             Withdraw unlocked stake tokens in decimal units.

Environment:
  JOB_REGISTRY_RPC / JOB_REGISTRY_HTTP        HTTP JSON-RPC endpoint (default http://127.0.0.1:8545).
  JOB_REGISTRY_WS / JOB_REGISTRY_WSS          WebSocket endpoint for event subscriptions.
  JOB_REGISTRY_ADDRESS_FILE                   Override JobRegistry addresses manifest (defaults to mainnet addresses).
  JOB_REGISTRY_ABI_FILE                       Override JobRegistry ABI path.
  JOB_REGISTRY_ADDRESS                        Override JobRegistry address (takes precedence over manifest).
  STAKE_MANAGER_ADDRESS_FILE                  Override StakeManager addresses manifest.
  STAKE_MANAGER_ABI_FILE                      Override StakeManager ABI path.
  STAKE_MANAGER_ADDRESS                       Override StakeManager address (takes precedence over manifest).
  STAKE_TOKEN_ABI_FILE                        Override the ERC-20 ABI used for stake approvals.
  WORKER_PRIVATE_KEY / PRIVATE_KEY            Private key for the committing account (0x-prefixed hex).
  WORKER_REQUIRED_STAKE / AGENT_REQUIRED_STAKE  Optional decimal stake requirement enforced off-chain.
  JOB_COMMIT_STORE                            Override path for the local commit secret store.
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
    case 'stake:status':
      return stakeStatus();
    case 'stake:deposit':
      return depositStake(args);
    case 'stake:withdraw':
      return withdrawStake(args);
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

function getJobRegistryContract(web3) {
  return new web3.eth.Contract(JOB_REGISTRY_ABI, JOB_REGISTRY_ADDRESS);
}

function getStakeManagerContract(web3) {
  if (!STAKE_MANAGER_ADDRESS) {
    throw new Error(
      'StakeManager address not configured. Set STAKE_MANAGER_ADDRESS or update the address manifest.'
    );
  }
  return new web3.eth.Contract(STAKE_MANAGER_ABI, STAKE_MANAGER_ADDRESS);
}

async function getStakeManagerMetadata(web3) {
  const stakeManager = getStakeManagerContract(web3);
  const [tokenAddress, decimalsRaw] = await Promise.all([
    stakeManager.methods.stakeToken().call(),
    stakeManager.methods.stakeTokenDecimals().call(),
  ]);
  const decimals = Number(decimalsRaw);
  if (!Number.isInteger(decimals)) {
    throw new Error(`Unexpected stake token decimals response: ${decimalsRaw}`);
  }
  return { stakeManager, tokenAddress, decimals };
}

function getStakeTokenContract(web3, tokenAddress) {
  return new web3.eth.Contract(ERC20_ABI, tokenAddress);
}

function parseTokenAmount(input, decimals) {
  const value = String(input || '').trim();
  if (!value) {
    throw new Error('Token amount argument required.');
  }
  if (value.startsWith('raw:')) {
    const raw = value.slice(4);
    if (!/^\d+$/.test(raw)) {
      throw new Error(`Invalid raw token amount '${value}'.`);
    }
    return raw.replace(/^0+(?=\d)/, '') || '0';
  }

  const [wholePart, fractionalPart = ''] = value.split('.');
  const normalizedWhole = wholePart === '' ? '0' : wholePart;
  if (!/^\d+$/.test(normalizedWhole)) {
    throw new Error(`Invalid decimal token amount '${value}'.`);
  }
  if (!/^\d*$/.test(fractionalPart)) {
    throw new Error(`Invalid decimal token amount '${value}'.`);
  }
  if (fractionalPart.length > decimals) {
    throw new Error(
      `Amount '${value}' exceeds stake token precision (${decimals} decimal places).`
    );
  }

  const base = 10n ** BigInt(decimals);
  const whole = BigInt(normalizedWhole) * base;
  let fraction = 0n;
  if (decimals > 0 && fractionalPart.length > 0) {
    const padded = fractionalPart.padEnd(decimals, '0');
    fraction = BigInt(padded);
  }
  return (whole + fraction).toString();
}

function formatTokenAmount(rawAmount, decimals) {
  const value = BigInt(rawAmount || 0);
  if (decimals === 0) {
    return value.toString();
  }
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  if (fraction === 0n) {
    return whole.toString();
  }
  const fractionStr = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fractionStr}`;
}

async function ensureStakeRequirement(web3, account) {
  if (!STAKE_MANAGER_ADDRESS) {
    process.stdout.write(
      'StakeManager address unavailable; skipping stake availability check.\n'
    );
    return;
  }

  const { stakeManager, decimals } = await getStakeManagerMetadata(web3);
  const availableRaw = await stakeManager.methods.availableStake(account.address).call();
  const availableFormatted = formatTokenAmount(availableRaw, decimals);
  process.stdout.write(
    `Available stake for ${account.address}: ${availableFormatted} tokens (${availableRaw} raw units).\n`
  );

  if (!REQUIRED_STAKE) {
    return;
  }

  const requiredRaw = parseTokenAmount(REQUIRED_STAKE, decimals);
  const requiredFormatted = formatTokenAmount(requiredRaw, decimals);
  if (BigInt(availableRaw) < BigInt(requiredRaw)) {
    throw new Error(
      `Available stake ${availableFormatted} below required threshold ${requiredFormatted}. Increase stake before committing.`
    );
  }

  process.stdout.write(
    `Stake requirement ${requiredFormatted} tokens satisfied (configured via WORKER_REQUIRED_STAKE/AGENT_REQUIRED_STAKE).\n`
  );
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
  const registry = getJobRegistryContract(web3);

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
  const registry = getJobRegistryContract(web3);

  await ensureStakeRequirement(web3, account);

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
  const registry = getJobRegistryContract(web3);

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
  const registry = getJobRegistryContract(web3);

  process.stdout.write(
    `Finalizing job ${jobId} with success=${successFlag} from ${account.address}.\n`
  );

  await registry.methods.finalizeJob(jobId, successFlag).send({
    from: account.address,
    gas: 400000,
  });

  process.stdout.write('Finalize transaction broadcast.\n');
}

async function stakeStatus() {
  const web3 = createHttpClient();
  const account = requireAccount(web3);
  const { stakeManager, tokenAddress, decimals } = await getStakeManagerMetadata(web3);
  const [totalDepositsRaw, lockedRaw, availableRaw] = await Promise.all([
    stakeManager.methods.totalDeposits(account.address).call(),
    stakeManager.methods.lockedAmounts(account.address).call(),
    stakeManager.methods.availableStake(account.address).call(),
  ]);

  const totalFormatted = formatTokenAmount(totalDepositsRaw, decimals);
  const lockedFormatted = formatTokenAmount(lockedRaw, decimals);
  const availableFormatted = formatTokenAmount(availableRaw, decimals);

  process.stdout.write(`Stake status for ${account.address} @ ${STAKE_MANAGER_ADDRESS}\n`);
  process.stdout.write(`  Stake token: ${tokenAddress} (decimals ${decimals})\n`);
  process.stdout.write(
    `  Total deposits: ${totalFormatted} tokens (${totalDepositsRaw} raw units)\n`
  );
  process.stdout.write(`  Locked: ${lockedFormatted} tokens (${lockedRaw} raw units)\n`);
  process.stdout.write(
    `  Available: ${availableFormatted} tokens (${availableRaw} raw units)\n`
  );
}

async function depositStake(args) {
  if (!args[0]) {
    throw new Error('stake:deposit requires an <amount> argument.');
  }

  const web3 = createHttpClient();
  const account = requireAccount(web3);
  const { stakeManager, tokenAddress, decimals } = await getStakeManagerMetadata(web3);
  const stakeToken = getStakeTokenContract(web3, tokenAddress);

  const amountRaw = parseTokenAmount(args[0], decimals);
  if (BigInt(amountRaw) <= 0n) {
    throw new Error('Deposit amount must be greater than zero.');
  }

  const formattedAmount = formatTokenAmount(amountRaw, decimals);
  process.stdout.write(
    `Preparing to deposit ${formattedAmount} tokens (${amountRaw} raw units). Stake token ${tokenAddress} (decimals ${decimals}).\n`
  );

  const allowanceRaw = await stakeToken.methods
    .allowance(account.address, STAKE_MANAGER_ADDRESS)
    .call();

  if (BigInt(allowanceRaw) < BigInt(amountRaw)) {
    const allowanceFormatted = formatTokenAmount(allowanceRaw, decimals);
    process.stdout.write(
      `Current allowance ${allowanceFormatted} tokens insufficient; approving StakeManager ${STAKE_MANAGER_ADDRESS}...\n`
    );
    await stakeToken.methods.approve(STAKE_MANAGER_ADDRESS, amountRaw).send({
      from: account.address,
      gas: 100000,
    });
    process.stdout.write('Stake token approval transaction broadcast.\n');
  } else {
    process.stdout.write('Existing allowance covers requested deposit; skipping approval.\n');
  }

  process.stdout.write(
    `Depositing ${formattedAmount} tokens to StakeManager ${STAKE_MANAGER_ADDRESS}...\n`
  );
  await stakeManager.methods.deposit(amountRaw).send({
    from: account.address,
    gas: 200000,
  });
  process.stdout.write('Deposit transaction broadcast.\n');
}

async function withdrawStake(args) {
  if (!args[0]) {
    throw new Error('stake:withdraw requires an <amount> argument.');
  }

  const web3 = createHttpClient();
  const account = requireAccount(web3);
  const { stakeManager, decimals } = await getStakeManagerMetadata(web3);
  const amountRaw = parseTokenAmount(args[0], decimals);
  if (BigInt(amountRaw) <= 0n) {
    throw new Error('Withdraw amount must be greater than zero.');
  }

  const formattedAmount = formatTokenAmount(amountRaw, decimals);
  process.stdout.write(
    `Withdrawing ${formattedAmount} tokens (${amountRaw} raw units) from StakeManager ${STAKE_MANAGER_ADDRESS}...\n`
  );

  await stakeManager.methods.withdraw(amountRaw).send({
    from: account.address,
    gas: 200000,
  });

  process.stdout.write('Withdraw transaction broadcast.\n');
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
