const { spawn } = require('child_process');
const http = require('http');

const HOST = '127.0.0.1';
const PORT = 8545;

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

async function waitForHardhatNode({ host = HOST, port = PORT, timeout = 60000, interval = 500 } = {}) {
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

async function run() {
  const hardhatNode = spawn(
    'npx',
    ['hardhat', 'node', '--hostname', HOST, '--port', String(PORT)],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  );

  let truffle;
  let exiting = false;

  const cleanup = () => {
    if (truffle && truffle.exitCode === null && !truffle.killed) {
      truffle.kill('SIGINT');
    }
    if (hardhatNode.exitCode === null && !hardhatNode.killed) {
      hardhatNode.kill('SIGINT');
    }
  };

  const terminate = (code) => {
    if (exiting) {
      return;
    }
    exiting = true;
    cleanup();
    process.exit(code);
  };

  const handleSignal = (signal) => {
    console.warn(`Received ${signal}. Stopping Hardhat node and tests...`);
    terminate(1);
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);
  process.on('exit', cleanup);

  await new Promise((resolve, reject) => {
    const handleExit = (code, signal) => {
      if (!exiting) {
        reject(
          new Error(
            `Hardhat node exited before it became ready (code: ${code ?? 'null'}, signal: ${signal ?? 'null'})`
          )
        );
      }
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

  truffle = spawn('npx', ['truffle', 'test'], { stdio: 'inherit' });

  truffle.on('error', (error) => {
    console.error(`Failed to run Truffle tests: ${error.message}`);
    terminate(1);
  });

  hardhatNode.on('exit', (code, signal) => {
    if (!exiting && (code ?? 0) !== 0) {
      console.error(
        `Hardhat node exited unexpectedly with code ${code ?? 'null'}${signal ? ` (signal ${signal})` : ''}`
      );
    }
  });

  truffle.on('exit', (code, signal) => {
    if (signal) {
      console.error(`Truffle tests terminated with signal ${signal}`);
      terminate(1);
      return;
    }
    terminate(code ?? 1);
  });
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
