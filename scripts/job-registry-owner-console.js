const JobRegistry = artifacts.require('JobRegistry');

const {
  parseOwnerConsoleArgs,
  collectOwnerStatus,
  buildOwnerTxPlan,
  formatStatusLines,
  formatTxPlanLines,
  buildOwnerCallSummary,
  writeOwnerCallSummary,
} = require('./lib/job-registry-owner');

function printHelp() {
  console.log('AGI Jobs v1 — JobRegistry owner console');
  console.log(
    'Usage: npx truffle exec scripts/job-registry-owner-console.js --network <network> [options]'
  );
  console.log('');
  console.log('Positional action (defaults to status):');
  console.log('  status      Display configuration and optional job summary');
  console.log("  extend      Extend a job's deadlines");
  console.log('  finalize    Finalize a revealed job');
  console.log('  timeout     Timeout a stalled job');
  console.log('  resolve     Resolve an active dispute');
  console.log('');
  console.log('Common options:');
  console.log('  --help                 Print this message');
  console.log('  --from <address>       Sender address (defaults to first unlocked account)');
  console.log('  --execute[=true|false] Broadcast the transaction (defaults to false)');
  console.log('  --dry-run[=true|false] Alias for --execute');
  console.log('  --job <id>             Target job identifier (required for actions)');
  console.log('  --plan-out <file>      Write a multisig-ready JSON plan to the specified path');
  console.log('');
  console.log('Extend options:');
  console.log('  --commit-extension <seconds>   Additional commit window seconds');
  console.log('  --reveal-extension <seconds>   Additional reveal window seconds');
  console.log('  --dispute-extension <seconds>  Additional dispute window seconds');
  console.log('');
  console.log('Finalize options:');
  console.log('  --success[=true|false]   Whether the job succeeded (default true)');
  console.log('');
  console.log('Timeout options:');
  console.log('  --slash-amount <value>   Slash amount (defaults to 0)');
  console.log('');
  console.log('Resolve options:');
  console.log('  --slash-worker[=true|false]  Slash the worker (default false)');
  console.log('  --slash-amount <value>       Stake to slash (default 0)');
  console.log('  --reputation-delta <value>   Signed reputation delta (default 0)');
}

module.exports = async function (callback) {
  try {
    const options = parseOwnerConsoleArgs(process.argv);
    if (options.help) {
      printHelp();
      callback();
      return;
    }

    const registry = await JobRegistry.deployed();
    const owner = await registry.owner();
    const accounts = await web3.eth.getAccounts();
    const sender = options.from || accounts[0];

    if (!sender) {
      throw new Error('No sender account is available. Specify --from explicitly.');
    }

    const isOwner = sender && owner && sender.toLowerCase() === owner.toLowerCase();

    if (!options.action || options.action === 'status') {
      const status = await collectOwnerStatus({ registry, web3, owner, jobId: options.jobId });
      const lines = formatStatusLines(status);
      lines.forEach((line) => console.log(line));
      callback();
      return;
    }

    const plan = await buildOwnerTxPlan({ registry, web3, options });
    const callData = registry.contract.methods[plan.method](...plan.args).encodeABI();
    const lines = formatTxPlanLines(plan, callData, { to: registry.address });
    lines.forEach((line) => console.log(line));

    const summary = buildOwnerCallSummary(plan, callData, {
      to: registry.address,
      from: sender,
    });

    if (options.planOut) {
      const writtenPath = writeOwnerCallSummary(summary, options.planOut);
      console.log(`Plan summary written to ${writtenPath}`);
    }

    if (!options.execute) {
      console.log('Dry run: transaction not broadcast.');
      console.log(JSON.stringify(summary.call, null, 2));
      callback();
      return;
    }

    if (!isOwner) {
      throw new Error(`Sender ${sender} is not the JobRegistry owner (${owner}).`);
    }

    const receipt = await registry[plan.method](...plan.args, { from: sender });
    console.log(`Transaction broadcast. Hash: ${receipt.tx}`);
    callback();
  } catch (error) {
    callback(error);
  }
};
