const { spawn } = require('child_process');
const path = require('path');

async function run() {
  const ganache = spawn(
    path.join('node_modules', '.bin', 'ganache'),
    ['--chain.networkId', '5777', '--wallet.totalAccounts', '10', '--logging.quiet'],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  );

  await new Promise((resolve) => setTimeout(resolve, 3000));

  const truffle = spawn('npx', ['truffle', 'test'], { stdio: 'inherit' });

  truffle.on('exit', (code) => {
    ganache.kill('SIGINT');
    process.exit(code);
  });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
