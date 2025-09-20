const { spawn } = require('child_process');
const http = require('http');
const net = require('net');

const HARDHAT_CLI = require.resolve('hardhat/internal/cli/cli');

const HOST = process.env.HARDHAT_HOST || '127.0.0.1';
const PORT = Number(process.env.HARDHAT_PORT || 8545);
const HARDHAT_READY_TIMEOUT = 60_000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonRpcRequest({ host, port, body, timeout }) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host,
        port,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve(Buffer.concat(chunks).toString('utf8'));
          } else {
            reject(new Error(`Unexpected status code ${response.statusCode}`));
          }
        });
      }
    );

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy(new Error('Request timed out'));
    });

    request.write(body);
    request.end();
  });
}

async function ensurePortAvailable({ host = HOST, port = PORT } = {}) {
  await new Promise((resolve, reject) => {
    const tester = net.createServer();
    tester.once('error', (error) => {
      tester.close(() => {
        if (error.code === 'EADDRINUSE') {
          reject(new Error(`Port ${port} on ${host} is already in use. Stop the process listening on it or set HARDHAT_PORT.`));
        } else {
          reject(error);
        }
      });
    });
    tester.once('listening', () => {
      tester.close(resolve);
    });
    tester.listen(port, host);
  });
}

async function waitForHardhatNode({ host = HOST, port = PORT, timeout = HARDHAT_READY_TIMEOUT, interval = 500 } = {}) {
  const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'net_version', params: [] });
  const start = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await jsonRpcRequest({ host, port, body: payload, timeout: interval });
      return;
    } catch (error) {
      if (Date.now() - start >= timeout) {
        throw new Error(`Timed out waiting for Hardhat node on ${host}:${port}: ${error.message}`);
      }
      await delay(interval);
    }
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });

    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} ${args.join(' ')} terminated with signal ${signal}`));
        return;
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });

    child.once('error', (error) => {
      reject(new Error(`Failed to start ${command} ${args.join(' ')}: ${error.message}`));
    });
  });
}

async function stopProcess(proc, { signal = 'SIGINT', forceSignal = 'SIGKILL', timeout = 5000 } = {}) {
  if (!proc || proc.killed || proc.exitCode !== null) {
    return;
  }

  await new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    const timer = setTimeout(() => {
      if (!settled) {
        try {
          proc.kill(forceSignal);
        } catch (_) {
          // ignore
        }
      }
    }, timeout);

    proc.once('exit', () => {
      clearTimeout(timer);
      cleanup();
    });

    try {
      proc.kill(signal);
    } catch (error) {
      if (error.code === 'ESRCH') {
        clearTimeout(timer);
        cleanup();
        return;
      }
      try {
        proc.kill(forceSignal);
      } catch (_) {
        // ignore
      }
    }
  });
}

async function startHardhatNode() {
  await ensurePortAvailable();

  const hardhat = spawn(process.execPath, [HARDHAT_CLI, 'node', '--hostname', HOST, '--port', String(PORT)], {
    stdio: 'inherit',
  });

  await new Promise((resolve, reject) => {
    const handleExit = (code, signal) => {
      reject(
        new Error(
          `Hardhat node exited before it became ready (code: ${code ?? 'null'}${signal ? `, signal: ${signal}` : ''})`
        )
      );
    };

    const handleError = (error) => {
      reject(new Error(`Failed to start Hardhat node: ${error.message}`));
    };

    hardhat.once('exit', handleExit);
    hardhat.once('error', handleError);

    waitForHardhatNode()
      .then(() => {
        hardhat.off('exit', handleExit);
        hardhat.off('error', handleError);
        resolve();
      })
      .catch((error) => {
        hardhat.off('exit', handleExit);
        hardhat.off('error', handleError);
        reject(error);
      });
  });

  return hardhat;
}

async function run() {
  const network = process.env.NETWORK || 'development';
  let hardhat;

  try {
    hardhat = await startHardhatNode();

    await runCommand('npx', ['truffle', 'migrate', '--reset', '--network', network], {
      env: { ...process.env, TRUFFLE_TEST: 'true' },
    });

    await runCommand('npx', ['truffle', 'exec', 'scripts/export-addresses.js', '--network', network], {
      env: { ...process.env, NETWORK: network },
    });

    await runCommand('node', ['scripts/export-abis.js'], { env: process.env });
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    await stopProcess(hardhat);
  }
}

run().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
