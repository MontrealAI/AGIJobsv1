const { spawn } = require('child_process');
const path = require('path');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
    child.on('error', (error) => reject(error));
  });
}

async function stopProcess(proc) {
  if (!proc || proc.killed) {
    return;
  }

  await new Promise((resolve) => {
    proc.once('exit', resolve);
    proc.kill('SIGINT');
  });
}

async function run() {
  const network = process.env.NETWORK || 'development';
  const ganache = spawn(path.join('node_modules', '.bin', 'ganache'), [
    '--chain.networkId',
    '5777',
    '--wallet.totalAccounts',
    '10',
  ], {
    stdio: 'inherit',
  });

  try {
    await wait(3000);

    await runCommand('npx', ['truffle', 'migrate', '--reset', '--network', network], {
      env: { ...process.env, TRUFFLE_TEST: 'true' },
    });

    await runCommand('npx', ['truffle', 'exec', 'scripts/export-addresses.js', '--network', network], {
      env: { ...process.env, NETWORK: network },
    });

    await runCommand('node', ['scripts/export-abis.js'], {
      env: process.env,
    });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await stopProcess(ganache);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
