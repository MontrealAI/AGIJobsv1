const { spawn } = require('child_process');

async function run() {
  const hardhatNode = spawn(
    'npx',
    ['hardhat', 'node', '--hostname', '127.0.0.1', '--port', '8545'],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  );

  await new Promise((resolve) => setTimeout(resolve, 5000));

  const truffle = spawn('npx', ['truffle', 'test'], { stdio: 'inherit' });

  truffle.on('exit', (code) => {
    hardhatNode.kill('SIGINT');
    process.exit(code);
  });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
