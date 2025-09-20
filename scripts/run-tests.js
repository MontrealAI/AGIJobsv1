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

async function run() {
  await ensurePortAvailable();

  const hardhatNode = spawn(
    process.execPath,
    [HARDHAT_CLI, 'node', '--hostname', HOST, '--port', String(PORT)],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  );

  await new Promise((resolve, reject) => {
    const handleExit = (code, signal) => {
      reject(
        new Error(
          `Hardhat node exited before it became ready (code: ${code ?? 'null'}${signal ? `, signal ${signal}` : ''})`
        )
      );
    };

    const handleError = (error) => {
      reject(new Error(`Failed to start Hardhat node: ${error.message}`));
    };

    hardhatNode.once('exit', handleExit);
    hardhatNode.once('error', handleError);

    waitForHardhatNode()
      .then(() => {
        hardhatNode.off('exit', handleExit);
        hardhatNode.off('error', handleError);
        resolve();
      })
      .catch((error) => {
        hardhatNode.off('exit', handleExit);
        hardhatNode.off('error', handleError);
        reject(error);
      });
  });

  let truffle;
  let shuttingDown = false;

  const terminate = async (code) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    try {
      await stopProcess(truffle);
    } finally {
      await stopProcess(hardhatNode);
    }
    process.exit(code);
  };

  const handleSignal = (signal) => {
    console.warn(`Received ${signal}. Stopping Hardhat node and tests...`);
    terminate(1).catch((error) => {
      console.error(error.message || error);
      process.exit(1);
    });
  };

  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  hardhatNode.on('exit', (code, signal) => {
    if (!shuttingDown && (code ?? 0) !== 0) {
      console.error(
        `Hardhat node exited unexpectedly with code ${code ?? 'null'}${signal ? ` (signal ${signal})` : ''}`
      );
    }
  });

  try {
    truffle = spawn('npx', ['truffle', 'test'], { stdio: 'inherit' });

    truffle.on('error', (error) => {
      console.error(`Failed to run Truffle tests: ${error.message}`);
      terminate(1).catch((terminateError) => {
        console.error(terminateError.message || terminateError);
        process.exit(1);
      });
    });

    truffle.on('exit', (code, signal) => {
      if (signal) {
        console.error(`Truffle tests terminated with signal ${signal}`);
        terminate(1).catch((terminateError) => {
          console.error(terminateError.message || terminateError);
          process.exit(1);
        });
        return;
      }
      terminate(code ?? 1).catch((terminateError) => {
        console.error(terminateError.message || terminateError);
        process.exit(1);
      });
    });
  } catch (error) {
    await stopProcess(hardhatNode);
    throw error;
  }
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
