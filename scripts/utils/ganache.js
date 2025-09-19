const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const DEFAULT_PORT = 8545;
const DEFAULT_NETWORK_ID = 5777;
const DEFAULT_TOTAL_ACCOUNTS = 10;
const WAIT_INTERVAL_MS = 250;
const WAIT_ATTEMPTS = 40;
const STOP_TIMEOUT_MS = 5000;

function ganacheBinary() {
  if (process.env.GANACHE_BIN) {
    return process.env.GANACHE_BIN;
  }
  const binaryName = process.platform === 'win32' ? 'ganache.cmd' : 'ganache';
  return path.join(__dirname, '..', '..', 'node_modules', '.bin', binaryName);
}

async function isPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      server.close(() => resolve(false));
    });
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findFreePort(preferredPort) {
  if (preferredPort && (await isPortAvailable(preferredPort))) {
    return preferredPort;
  }

  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForPort(port, host = '127.0.0.1') {
  for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt += 1) {
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ port, host }, () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
    });

    if (connected) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, WAIT_INTERVAL_MS));
  }

  throw new Error(`Timed out waiting for Ganache to listen on ${host}:${port}`);
}

async function startGanache(options = {}) {
  const {
    port: preferredPort = Number(process.env.GANACHE_PORT) || DEFAULT_PORT,
    networkId = DEFAULT_NETWORK_ID,
    totalAccounts = DEFAULT_TOTAL_ACCOUNTS,
    chainId,
    extraArgs = [],
  } = options;

  const port = await findFreePort(preferredPort);
  const args = [
    '--server.port',
    String(port),
    '--chain.networkId',
    String(networkId),
    '--wallet.totalAccounts',
    String(totalAccounts),
    '--wallet.deterministic',
    ...extraArgs,
  ];

  if (chainId) {
    args.push('--chain.chainId', String(chainId));
  }

  const child = spawn(ganacheBinary(), args, {
    stdio: 'inherit',
    env: { ...process.env, GANACHE_PORT: String(port) },
  });

  let settled = false;

  return new Promise((resolve, reject) => {
    const onError = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    const onExit = (code, signal) => {
      if (!settled) {
        settled = true;
        reject(new Error(`Ganache exited before it became ready (code=${code}, signal=${signal})`));
      }
    };

    child.once('error', onError);
    child.once('exit', onExit);

    waitForPort(port)
      .then(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.off('error', onError);
        child.off('exit', onExit);
        resolve({ process: child, port });
      })
      .catch((error) => {
        if (!settled) {
          settled = true;
          child.off('error', onError);
          child.off('exit', onExit);
          reject(error);
        }
      });
  });
}

async function stopGanache(child) {
  if (!child || child.killed) {
    return;
  }

  await new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      if (settled) {
        return;
      }
      settled = true;
      child.removeAllListeners('exit');
      resolve();
    };

    child.once('exit', cleanup);

    const timeout = setTimeout(() => {
      if (child.killed) {
        cleanup();
        return;
      }
      child.kill('SIGKILL');
    }, STOP_TIMEOUT_MS);

    child.once('exit', () => {
      clearTimeout(timeout);
      cleanup();
    });

    if (!child.kill('SIGINT')) {
      clearTimeout(timeout);
      cleanup();
    }
  });
}

async function withGanache(task, options) {
  const { process: child, port } = await startGanache(options);
  const previousPort = process.env.GANACHE_PORT;
  process.env.GANACHE_PORT = String(port);

  try {
    return await task({ port, process: child });
  } finally {
    if (previousPort === undefined) {
      delete process.env.GANACHE_PORT;
    } else {
      process.env.GANACHE_PORT = previousPort;
    }
    await stopGanache(child);
  }
}

module.exports = {
  startGanache,
  stopGanache,
  withGanache,
  waitForPort,
};
