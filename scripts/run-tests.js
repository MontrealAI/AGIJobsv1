const { spawn } = require('child_process');
const path = require('path');

async function startGanache() {
  return new Promise((resolve, reject) => {
    const ganachePath = path.join('node_modules', '.bin', process.platform === 'win32' ? 'ganache.cmd' : 'ganache');
    const ganache = spawn(ganachePath, ['--chain.networkId', '5777', '--wallet.totalAccounts', '20'], {
      stdio: ['ignore', 'pipe', 'inherit']
    });

    let resolved = false;
    let buffer = '';

    ganache.stdout.on('data', (data) => {
      const text = data.toString();
      buffer += text;
      process.stdout.write(text);
      if (!resolved && buffer.includes('Listening on')) {
        resolved = true;
        resolve(ganache);
      }
    });

    ganache.on('error', (error) => {
      if (!resolved) {
        reject(error);
      }
    });

    ganache.on('exit', (code) => {
      if (!resolved) {
        reject(new Error(`Ganache exited early with code ${code}`));
      }
    });
  });
}

async function runTests() {
  process.env.TRUFFLE_TEST = 'true';
  const ganache = await startGanache();

  await new Promise((resolve, reject) => {
    const truffle = spawn('npx', ['truffle', 'test', '--show-events'], { stdio: 'inherit' });

    truffle.on('exit', (code) => {
      ganache.kill('SIGINT');
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Truffle tests exited with code ${code}`));
      }
    });

    truffle.on('error', (error) => {
      ganache.kill('SIGINT');
      reject(error);
    });
  });
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
