const { spawn } = require('child_process');
const path = require('path');

async function run() {
  const ganache = spawn(path.join('node_modules', '.bin', 'ganache'), [
    '--chain.networkId',
    '5777',
    '--wallet.totalAccounts',
    '10',
  ]);

  ganache.stdout.pipe(process.stdout);
  ganache.stderr.pipe(process.stderr);

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await wait(3000);

  await new Promise((resolve, reject) => {
    const migrate = spawn('npx', ['truffle', 'migrate', '--reset', '--network', 'development'], {
      stdio: 'inherit',
      env: { ...process.env, TRUFFLE_TEST: 'true' },
    });
    migrate.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`truffle migrate exited with code ${code}`));
      }
    });
  });

  await new Promise((resolve, reject) => {
    const exec = spawn('npx', ['truffle', 'exec', 'scripts/export-addresses.js', '--network', 'development'], {
      stdio: 'inherit',
      env: { ...process.env, NETWORK: 'development' },
    });
    exec.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`truffle exec exited with code ${code}`));
      }
    });
  });

  ganache.kill('SIGINT');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
