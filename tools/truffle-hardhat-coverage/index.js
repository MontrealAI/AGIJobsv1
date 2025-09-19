const { spawn } = require('child_process');

module.exports = function runHardhatCoverage(config) {
  const hardhatCli = require.resolve('hardhat/internal/cli/bootstrap');
  const args = [hardhatCli, 'coverage', '--testfiles', 'test/**/*.js'];

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: config.working_directory,
      stdio: 'inherit',
      env: { ...process.env },
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Hardhat coverage exited with code ${code}`));
      }
    });
  });
};
