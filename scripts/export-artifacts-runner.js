const { spawn } = require('child_process');

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
    let settled = false;
    const onExit = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          process.kill(-proc.pid, 'SIGKILL');
        } catch (_) {
          proc.kill('SIGKILL');
        }
        resolve();
      }
    }, 5000);

    proc.once('exit', () => {
      clearTimeout(timeout);
      onExit();
    });

    try {
      process.kill(-proc.pid, 'SIGINT');
    } catch (_) {
      proc.kill('SIGINT');
    }
  });
}

async function run() {
  const network = process.env.NETWORK || 'development';
  const hardhat = spawn(
    'npx',
    ['hardhat', 'node', '--hostname', '127.0.0.1', '--port', '8545'],
    { stdio: 'inherit', detached: true }
  );

  try {
    await wait(5000);

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
    await stopProcess(hardhat);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
