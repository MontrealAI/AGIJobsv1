const { spawn } = require('child_process');

const isWindows = process.platform === 'win32';

function normalizeOptions(options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  const merged = {
    stdio: 'inherit',
    shell: options.shell ?? isWindows,
    ...options,
    env,
  };

  return merged;
}

function runCommand(command, args = [], options = {}) {
  const child = spawn(command, args, normalizeOptions(options));

  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        const description =
          code === null ? `terminated by signal ${signal}` : `exited with code ${code}`;
        reject(new Error(`${command} ${args.join(' ')} ${description}`));
      }
    });
  });
}

module.exports = { runCommand };
