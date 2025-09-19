const { withGanache } = require('./utils/ganache');
const { runCommand } = require('./utils/runCommand');

async function run() {
  await runCommand('npx', ['truffle', 'compile', '--all']);
  await withGanache(async () => {
    await runCommand('npx', ['truffle', 'test', '--show-events']);
  }, {
    networkId: 5777,
    totalAccounts: 10,
  });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
