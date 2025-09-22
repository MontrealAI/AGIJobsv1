const IdentityRegistry = artifacts.require('IdentityRegistry');

const {
  ACTIONS,
  parseEmergencyConsoleArgs,
  resolveCheckAddresses,
  resolveModificationEntries,
  formatStatusLines,
  formatPlanLines,
  collectEmergencyStatus,
  buildEmergencyPlanEntries,
  enrichPlanEntriesWithCalldata,
  buildPlanSummary,
  writePlanSummary,
} = require('./lib/identity-registry-emergency');
const { extractNetwork, toChecksum } = require('./lib/job-registry-config-utils');

function printHelp() {
  console.log('AGI Jobs v1 — IdentityRegistry emergency access console');
  console.log('Usage: npx truffle exec scripts/identity-registry-emergency.js --network <network> [action] [options]');
  console.log('');
  console.log('Actions:');
  console.log('  status   Display emergency access status for the provided addresses (default)');
  console.log('  set      Grant or revoke emergency access for specific addresses');
  console.log('');
  console.log('Common options:');
  console.log('  --from <address>         Sender address (defaults to first unlocked account)');
  console.log('  --execute[=true|false]  Broadcast transaction instead of dry run');
  console.log('  --dry-run[=true|false]  Alias for --execute');
  console.log('  --plan-out <file>       Persist Safe-ready plan JSON to the provided path');
  console.log('  --help                  Show this message');
  console.log('');
  console.log('Status options:');
  console.log('  --check <address>       Address to inspect (repeatable)');
  console.log('  --file <path>           JSON or newline-separated file of addresses to inspect');
  console.log('');
  console.log('Set options:');
  console.log('  --allow <address>       Grant emergency access (repeatable or comma-separated)');
  console.log('  --revoke <address>      Revoke emergency access (repeatable or comma-separated)');
  console.log('  --batch <json>          Inline JSON array of {"address","allowed"} entries');
  console.log('  --batch-file <path>     JSON or newline-separated file of address + allowed entries');
}

module.exports = async function (callback) {
  try {
    const options = parseEmergencyConsoleArgs(process.argv);
    if (options.help) {
      printHelp();
      callback();
      return;
    }

    const action = options.action || ACTIONS.STATUS;
    if (!Object.values(ACTIONS).includes(action)) {
      throw new Error(`Unsupported action "${options.action}". Use status or set.`);
    }

    const networkName = extractNetwork(process.argv) || process.env.NETWORK || process.env.TRUFFLE_NETWORK || null;
    const identity = await IdentityRegistry.deployed();
    const identityAddress = toChecksum(identity.address);
    const owner = toChecksum(await identity.owner());

    if (options.from && !web3.utils.isAddress(options.from)) {
      throw new Error(`Invalid --from address: ${options.from}`);
    }

    const accounts = await web3.eth.getAccounts();
    const sender = options.from
      ? toChecksum(options.from)
      : accounts[0]
        ? toChecksum(accounts[0])
        : null;

    if (!sender) {
      throw new Error('No sender account is available. Specify --from explicitly.');
    }

    console.log('AGIJobsv1 — IdentityRegistry emergency access console');
    console.log(`Action: ${action}`);
    console.log(`Network: ${networkName || '(unspecified)'}`);
    console.log(`IdentityRegistry: ${identityAddress}`);
    console.log(`Owner: ${owner || '(unknown)'}`);
    console.log(`Sender: ${sender}`);
    console.log('');

    if (action === ACTIONS.STATUS) {
      const addresses = resolveCheckAddresses({ inline: options.check, filePath: options.checkFile });
      const statusEntries = await collectEmergencyStatus(identity, addresses);
      formatStatusLines(statusEntries).forEach((line) => console.log(line));
      callback();
      return;
    }

    const modifications = resolveModificationEntries({
      allowList: options.allow,
      revokeList: options.revoke,
      batch: options.batch,
      filePath: options.batchFile,
    });

    if (modifications.length === 0) {
      throw new Error('No emergency access changes provided. Use --allow/--revoke/--batch/--batch-file.');
    }

    const planEntries = buildEmergencyPlanEntries(modifications);
    const enrichedEntries = enrichPlanEntriesWithCalldata(identity, planEntries);

    formatPlanLines(planEntries).forEach((line) => console.log(line));

    const summary = buildPlanSummary({
      identityAddress,
      owner,
      sender,
      planEntries: enrichedEntries,
    });

    if (options.planOut) {
      const writtenPath = writePlanSummary(summary, options.planOut);
      console.log(`\nPlan summary written to ${writtenPath}`);
    }

    if (!options.execute) {
      console.log('\nDry run: transaction not broadcast.');
      console.log(JSON.stringify(summary, null, 2));
      callback();
      return;
    }

    if (!owner || owner.toLowerCase() !== sender.toLowerCase()) {
      throw new Error(`Sender ${sender} is not the IdentityRegistry owner (${owner}).`);
    }

    for (let i = 0; i < enrichedEntries.length; i += 1) {
      const step = enrichedEntries[i];
      // eslint-disable-next-line no-await-in-loop
      const receipt = await identity[step.method](...step.args, { from: sender });
      console.log(`Broadcast ${step.method}(${toChecksum(step.address)}, ${step.allowed}) — tx: ${receipt.tx}`);
    }

    callback();
  } catch (error) {
    callback(error);
  }
};
