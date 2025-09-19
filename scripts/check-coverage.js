const fs = require('fs');
const path = require('path');

const DEFAULT_THRESHOLD = 90;

function parseArgs(argv) {
  const tokens = Array.isArray(argv) ? [...argv] : [];
  let minValue;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === '--min' || token === '-m') {
      if (index + 1 >= tokens.length) {
        throw new Error('Missing value for --min option');
      }
      minValue = tokens[index + 1];
      index += 1;
    } else if (token.startsWith('--min=')) {
      minValue = token.slice('--min='.length);
    }
  }

  const fallback = process.env.COVERAGE_THRESHOLD;
  const thresholdSource =
    minValue !== undefined ? minValue : fallback !== undefined ? fallback : DEFAULT_THRESHOLD;
  const threshold = Number(thresholdSource);

  if (!Number.isFinite(threshold)) {
    throw new Error('Coverage threshold must be a finite number');
  }

  return { min: threshold };
}

function aggregateLcov(content) {
  const lines = content.split(/\r?\n/);
  let totalLines = 0;
  let coveredLines = 0;

  lines.forEach((line) => {
    if (line.startsWith('LF:')) {
      const value = Number(line.slice(3));
      if (Number.isFinite(value)) {
        totalLines += value;
      }
    } else if (line.startsWith('LH:')) {
      const value = Number(line.slice(3));
      if (Number.isFinite(value)) {
        coveredLines += value;
      }
    }
  });

  return { totalLines, coveredLines };
}

function checkCoverage(options = {}) {
  const coverageDir = options.coverageDir || path.join(__dirname, '..', 'coverage');
  const lcovPath = options.lcovPath || path.join(coverageDir, 'lcov.info');

  if (!fs.existsSync(lcovPath)) {
    throw new Error(`Coverage report not found at ${lcovPath}`);
  }

  const content = fs.readFileSync(lcovPath, 'utf8');
  const { totalLines, coveredLines } = aggregateLcov(content);
  const pct = totalLines === 0 ? 100 : (coveredLines / totalLines) * 100;

  return { totalLines, coveredLines, pct, lcovPath };
}

function formatPercentage(value) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  return value.toFixed(2);
}

function main(argv) {
  let threshold;

  try {
    const args = parseArgs(argv);
    threshold = args.min;
  } catch (error) {
    console.error(error.message);
    return false;
  }

  let result;

  try {
    result = checkCoverage();
  } catch (error) {
    console.error(error.message);
    return false;
  }

  const { pct, totalLines, coveredLines, lcovPath } = result;

  if (!Number.isFinite(pct)) {
    console.error(`Unable to determine coverage percentage from ${lcovPath}`);
    return false;
  }

  if (pct < threshold) {
    console.error(
      `Line coverage ${formatPercentage(pct)}% is below required minimum of ${threshold}%`
    );
    console.error(`Covered ${coveredLines} out of ${totalLines} lines.`);
    return false;
  }

  console.log(
    `Coverage threshold met: ${formatPercentage(pct)}% (covered ${coveredLines}/${totalLines} lines)`
  );
  return true;
}

if (require.main === module) {
  const success = main(process.argv.slice(2));
  if (!success) {
    process.exit(1);
  }
}

module.exports = {
  aggregateLcov,
  checkCoverage,
  main,
  parseArgs,
  formatPercentage,
};
