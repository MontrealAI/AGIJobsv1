const IdentityRegistry = artifacts.require('IdentityRegistry');

const {
  ACTIONS,
  parseIdentityConsoleArgs,
  loadEnsConfig,
  buildSetPlan,
  formatStatusLines,
  formatPlanLines,
  collectCurrentConfig,
} = require('./lib/identity-registry-console');
const { extractNetwork, toChecksum } = require('./lib/job-registry-config-utils');
const { resolveVariant } = require('./config-loader');

function printHelp() {
  console.log('AGI Jobs v1 — IdentityRegistry ENS console');
  console.log('Usage: npx truffle exec scripts/identity-registry-console.js --network <network> [action] [options]');
  console.log('');
  console.log('Actions:');
  console.log('  status   Display current on-chain configuration (default)');
  console.log('  set      Align on-chain configuration with config files and optional overrides');
  console.log('');
  console.log('Common options:');
  console.log('  --from <address>         Sender address (defaults to first unlocked account)');
  console.log('  --execute[=true|false]  Broadcast transaction instead of dry run');
  console.log('  --dry-run[=true|false]  Alias for --execute');
  console.log('  --variant <name>        Optional config variant hint');
  console.log('  --config <path>         Explicit ENS config file path');
  console.log('  --help                  Show this message');
  console.log('');
  console.log('ENS overrides (applied on top of config file values):');
  console.log('  --ens.registry <address>');
  console.log('  --ens.nameWrapper <address>');
  console.log('  --ens.agentRoot <ens name> | --ens.agentRootHash <bytes32>');
  console.log('  --ens.clubRoot <ens name>  | --ens.clubRootHash <bytes32>');
  console.log('  --ens.alphaClubRoot <ens name> | --ens.alphaClubRootHash <bytes32>');
  console.log('  --ens.alphaEnabled[=true|false]');
  console.log('  --ens.alphaAgentRoot <ens name> | --ens.alphaAgentRootHash <bytes32>');
  console.log('  --ens.alphaAgentEnabled[=true|false]');
}

module.exports = async function (callback) {
  try {
    const options = parseIdentityConsoleArgs(process.argv);
    if (options.help) {
      printHelp();
      callback();
      return;
    }

    const action = options.action || ACTIONS.STATUS;
    if (!Object.values(ACTIONS).includes(action)) {
      throw new Error(`Unsupported action "${options.action}". Use status or set.`);
    }

    const networkName =
      extractNetwork(process.argv) || process.env.NETWORK || process.env.TRUFFLE_NETWORK || null;

    let resolvedVariant = null;
    try {
      resolvedVariant = resolveVariant(options.variant || networkName || undefined);
    } catch (error) {
      console.warn(
        `Warning: unable to resolve variant for "${options.variant || networkName || '(unspecified)'}": ${error.message}`
      );
    }

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

    const current = await collectCurrentConfig(identity);

    console.log('AGIJobsv1 — IdentityRegistry ENS console');
    console.log(`Action: ${action}`);
    console.log(
      `Network: ${networkName || '(unspecified)'}${resolvedVariant ? ` (variant: ${resolvedVariant})` : ''}`
    );
    console.log(`IdentityRegistry: ${identityAddress}`);
    console.log(`Owner: ${owner || '(unknown)'}`);
    console.log(`Sender: ${sender}`);
    console.log('');

    formatStatusLines(current).forEach((line) => console.log(line));
    console.log('');

    const variantForConfig = resolvedVariant || options.variant || networkName || undefined;

    if (action === ACTIONS.STATUS) {
      if (options.overrides && Object.keys(options.overrides).length > 0) {
        console.log('Overrides provided during status action are ignored.');
        console.log('');
      }

      if (options.configPath || variantForConfig) {
        try {
          const configProfile = loadEnsConfig({
            explicitPath: options.configPath,
            variant: variantForConfig,
          });
          console.log(`Config file: ${configProfile.path}`);
          const plan = buildSetPlan({ current, baseConfig: configProfile.values, overrides: {} });
          if (plan.changed) {
            console.log('');
            formatPlanLines(plan).forEach((line) => console.log(line));
          } else {
            console.log('\nOn-chain configuration already matches the desired profile.');
          }
        } catch (error) {
          console.warn(`Warning: unable to evaluate config drift: ${error.message}`);
        }
      }

      callback();
      return;
    }

    const shouldExecute = Boolean(options.execute);
    const configProfile = loadEnsConfig({
      explicitPath: options.configPath,
      variant: variantForConfig,
    });

    console.log(`Config file: ${configProfile.path}`);

    const plan = buildSetPlan({ current, baseConfig: configProfile.values, overrides: options.overrides });

    console.log('');
    formatPlanLines(plan).forEach((line) => console.log(line));

    if (!plan.changed) {
      console.log('\nOn-chain configuration already matches the desired profile.');
      callback();
      return;
    }

    const transactions = [];
    if (plan.configureChanged) {
      const callData = identity.contract.methods.configureEns(...plan.args).encodeABI();
      transactions.push({
        to: identity.address,
        from: sender,
        data: callData,
        value: '0',
        description: 'IdentityRegistry.configureEns',
        arguments: plan.args,
      });
    }
    if (plan.alphaAgent && plan.alphaAgent.changed) {
      const callData = identity.contract.methods.setAlphaAgentRoot(...plan.alphaAgent.args).encodeABI();
      transactions.push({
        to: identity.address,
        from: sender,
        data: callData,
        value: '0',
        description: 'IdentityRegistry.setAlphaAgentRoot',
        arguments: plan.alphaAgent.args,
      });
    }

    if (!shouldExecute) {
      console.log('\nDry run: transaction not broadcast.');
      console.log(JSON.stringify({ transactions }, null, 2));
      callback();
      return;
    }

    if (!owner || owner.toLowerCase() !== sender.toLowerCase()) {
      throw new Error(`Sender ${sender} is not the IdentityRegistry owner (${owner}).`);
    }

    if (plan.configureChanged) {
      const receipt = await identity.configureEns(...plan.args, { from: sender });
      console.log(`\nconfigureEns broadcast. Hash: ${receipt.tx}`);
    }
    if (plan.alphaAgent && plan.alphaAgent.changed) {
      const receipt = await identity.setAlphaAgentRoot(...plan.alphaAgent.args, { from: sender });
      console.log(`Alpha agent alias update broadcast. Hash: ${receipt.tx}`);
    }
    callback();
  } catch (error) {
    callback(error);
  }
};
