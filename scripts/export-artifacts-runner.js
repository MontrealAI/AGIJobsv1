const path = require('path');
const { withGanache } = require('./utils/ganache');
const { runCommand } = require('./utils/runCommand');

async function run() {
  const network = process.env.NETWORK || 'development';

  await withGanache(async () => {
    const sharedEnv = {
      ...process.env,
      NETWORK: network,
      TRUFFLE_TEST: process.env.TRUFFLE_TEST || 'true',
    };

    await runCommand('npx', ['truffle', 'migrate', '--reset', '--network', network], {
      env: sharedEnv,
    });

    await runCommand(
      'npx',
      ['truffle', 'exec', path.join('scripts', 'export-addresses.js'), '--network', network],
      { env: sharedEnv }
    );

    await runCommand('node', [path.join('scripts', 'export-abis.js')], {
      env: { ...process.env, NETWORK: network },
      shell: false,
    });
  });
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
