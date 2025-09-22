const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const { validateAllConfigs } = require('./validate-config');

const execFileAsync = promisify(execFile);

const MIN_NODE_VERSION = '18.18.0';
const MIN_NPM_VERSION = '9.6.0';
const REQUIRED_FILES = [
  'hardhat.config.js',
  'truffle-config.js',
  'scripts/run-tests.js',
  'scripts/validate-config.js',
];

function parseVersion(version) {
  if (typeof version !== 'string') {
    return null;
  }
  const trimmed = version.trim();
  const match = trimmed.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return match.slice(1, 4).map((segment) => Number.parseInt(segment, 10));
}

function compareParsedVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left > right) {
      return 1;
    }
    if (left < right) {
      return -1;
    }
  }
  return 0;
}

function compareVersions(current, minimum) {
  const parsedCurrent = parseVersion(current);
  const parsedMinimum = parseVersion(minimum);
  if (!parsedCurrent || !parsedMinimum) {
    return null;
  }
  return compareParsedVersions(parsedCurrent, parsedMinimum);
}

function checkVersion(current, minimum) {
  const result = {
    ok: false,
    current: current ? current.trim() : null,
    minimum,
    rawCurrent: current,
    rawMinimum: minimum,
  };

  const parsedCurrent = parseVersion(current);
  const parsedMinimum = parseVersion(minimum);

  if (!parsedCurrent) {
    result.reason = 'Unable to parse version string';
    return result;
  }
  if (!parsedMinimum) {
    result.reason = 'Internal error: minimum version is invalid';
    return result;
  }

  const comparison = compareParsedVersions(parsedCurrent, parsedMinimum);
  result.ok = comparison >= 0;
  if (!result.ok) {
    result.reason = `Detected version ${result.current} is below the minimum required ${minimum}`;
  }

  return result;
}

async function resolveNpmVersion(execImpl = execFileAsync) {
  try {
    const { stdout } = await execImpl('npm', ['--version'], { timeout: 10_000 });
    const version = stdout.trim();
    const status = checkVersion(version, MIN_NPM_VERSION);
    status.tool = 'npm';
    return status;
  } catch (error) {
    return {
      ok: false,
      tool: 'npm',
      current: null,
      minimum: MIN_NPM_VERSION,
      rawCurrent: null,
      rawMinimum: MIN_NPM_VERSION,
      reason: error && error.message ? error.message : 'Failed to execute npm --version',
    };
  }
}

function checkRequiredFiles({ cwd = process.cwd(), existsSync = fs.existsSync } = {}) {
  const missing = REQUIRED_FILES.filter((relativePath) => !existsSync(path.join(cwd, relativePath)));
  return {
    ok: missing.length === 0,
    missing,
  };
}

async function collectDiagnostics({
  env = process.env,
  execFileAsync: execImpl = execFileAsync,
  requireModule = (id) => require(id),
  validateConfigs = () => validateAllConfigs(),
  existsSync = fs.existsSync,
  cwd = process.cwd(),
} = {}) {
  const errors = [];
  const warnings = [];

  const nodeStatus = checkVersion(process.versions.node, MIN_NODE_VERSION);
  if (!nodeStatus.ok) {
    errors.push(`Node.js check failed: ${nodeStatus.reason || 'version too low'}`);
  }

  const npmStatus = await resolveNpmVersion(execImpl);
  if (!npmStatus.ok) {
    errors.push(`npm check failed: ${npmStatus.reason || 'version too low'}`);
  }

  const packageStatuses = [];
  ['hardhat', 'truffle'].forEach((pkgName) => {
    try {
      const pkg = requireModule(`${pkgName}/package.json`);
      packageStatuses.push({ name: pkgName, ok: true, version: pkg.version });
    } catch (error) {
      const reason = error && error.message ? error.message : 'Unknown error';
      packageStatuses.push({ name: pkgName, ok: false, error: reason });
      errors.push(`Dependency check failed for ${pkgName}: ${reason}`);
    }
  });

  let configStatus;
  try {
    const { errors: configErrors } = await Promise.resolve(validateConfigs());
    configStatus = { ok: configErrors.length === 0, errors: configErrors.slice() };
    configErrors.forEach((message) => {
      errors.push(`Configuration: ${message}`);
    });
  } catch (error) {
    const reason = error && error.message ? error.message : String(error);
    configStatus = { ok: false, errors: [reason] };
    errors.push(`Configuration validation failed to execute: ${reason}`);
  }

  const fileStatus = checkRequiredFiles({ cwd, existsSync });
  if (!fileStatus.ok) {
    errors.push(`Missing required project files: ${fileStatus.missing.join(', ')}`);
  }

  const envChecks = [
    {
      name: 'MNEMONIC',
      help: 'Required for live network migrations, ownership transfers, and verification.',
    },
    {
      name: 'RPC_MAINNET',
      help: 'HTTPS RPC endpoint required for mainnet deployments and verifications.',
    },
    {
      name: 'RPC_SEPOLIA',
      help: 'HTTPS RPC endpoint required for Sepolia deployments and staging rehearsals.',
    },
    {
      name: 'ETHERSCAN_API_KEY',
      help: 'Required for contract verification workflows (npm run verify:*).',
    },
    {
      name: 'GOV_SAFE',
      help: 'Target Safe that receives contract ownership during migrations.',
    },
    {
      name: 'TIMELOCK_ADDR',
      help: 'Optional timelock admin address configured on supported modules.',
    },
  ];

  const environmentStatus = envChecks.map((check) => {
    const present = Boolean(env[check.name] && String(env[check.name]).trim().length > 0);
    if (!present) {
      warnings.push(`Environment variable ${check.name} is not set. ${check.help}`);
    }
    return {
      name: check.name,
      present,
      help: check.help,
    };
  });

  const summary = {
    ok: errors.length === 0,
    errors: errors.length,
    warnings: warnings.length,
    generatedAt: new Date().toISOString(),
  };

  return {
    node: nodeStatus,
    npm: npmStatus,
    packages: packageStatuses,
    configs: configStatus,
    files: fileStatus,
    environment: environmentStatus,
    warnings,
    errors,
    summary,
  };
}

function printDiagnostics(report, { logger = console } = {}) {
  const { node, npm, packages, configs, files, environment, warnings, errors, summary } = report;

  const divider = (title) => {
    logger.log('\n' + title);
    logger.log('-'.repeat(title.length));
  };

  divider('Environment versions');
  const formatVersion = (label, status) => {
    if (status.ok) {
      logger.log(`✔ ${label}: ${status.current} (minimum ${status.minimum})`);
    } else {
      logger.log(`✖ ${label}: ${status.current || 'unknown'} (minimum ${status.minimum}) — ${status.reason || 'check failed'}`);
    }
  };
  formatVersion('Node.js', node);
  formatVersion('npm', npm);

  divider('Key packages');
  packages.forEach((pkg) => {
    if (pkg.ok) {
      logger.log(`✔ ${pkg.name}@${pkg.version}`);
    } else {
      logger.log(`✖ ${pkg.name} — ${pkg.error}`);
    }
  });

  divider('Configuration files');
  if (configs.ok) {
    logger.log('✔ Configuration validation passed');
  } else if (configs.errors.length === 0) {
    logger.log('✖ Configuration validation failed for unknown reasons. Run npm run config:validate for details.');
  } else {
    logger.log('✖ Configuration issues detected:');
    configs.errors.forEach((message) => logger.log(`  - ${message}`));
  }

  divider('Required project files');
  if (files.ok) {
    logger.log('✔ All critical project files are present');
  } else {
    logger.log('✖ Missing files:');
    files.missing.forEach((file) => logger.log(`  - ${file}`));
  }

  divider('Environment variables');
  environment.forEach((entry) => {
    if (entry.present) {
      logger.log(`✔ ${entry.name}`);
    } else {
      logger.log(`⚠ ${entry.name} — ${entry.help}`);
    }
  });

  divider('Summary');
  logger.log(`Errors: ${summary.errors}`);
  logger.log(`Warnings: ${summary.warnings}`);
  logger.log(`Generated at: ${summary.generatedAt}`);

  if (errors.length > 0) {
    logger.log('\nDetailed errors:');
    errors.forEach((message) => logger.log(` - ${message}`));
  }
  if (warnings.length > 0) {
    logger.log('\nDetailed warnings:');
    warnings.forEach((message) => logger.log(` - ${message}`));
  }
}

async function main() {
  const report = await collectDiagnostics();
  printDiagnostics(report);
  if (!report.summary.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = {
  collectDiagnostics,
  printDiagnostics,
  _internal: {
    parseVersion,
    compareVersions,
    compareParsedVersions,
    checkVersion,
    resolveNpmVersion,
    checkRequiredFiles,
    MIN_NODE_VERSION,
    MIN_NPM_VERSION,
    REQUIRED_FILES,
  },
};
