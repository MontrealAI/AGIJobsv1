'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const tar = require('tar');

const {
  loadParams,
  formatSummary,
  DEFAULT_PARAMS_PATH,
} = require('./edit-params');

const DEFAULT_VARIANT = 'mainnet';
const INSTRUCTIONS_FILENAME = 'INSTRUCTIONS.md';
const MANIFEST_FILENAME = 'release-manifest.json';
const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_PARAMS_RELATIVE = path.relative(REPO_ROOT, DEFAULT_PARAMS_PATH);

function parseArgs(argv) {
  const args = { variant: DEFAULT_VARIANT, outFile: null, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--variant') {
      if (i + 1 >= argv.length) {
        throw new Error('--variant requires a value');
      }
      args.variant = argv[i + 1];
      i += 1;
    } else if (token.startsWith('--variant=')) {
      args.variant = token.slice('--variant='.length);
    } else if (token === '--out') {
      if (i + 1 >= argv.length) {
        throw new Error('--out requires a value');
      }
      args.outFile = argv[i + 1];
      i += 1;
    } else if (token.startsWith('--out=')) {
      args.outFile = token.slice('--out='.length);
    } else if (token === '--help' || token === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.variant || typeof args.variant !== 'string') {
    throw new Error('Variant must be a non-empty string');
  }

  return args;
}

function printHelp({ logger = console } = {}) {
  logger.log('Usage: node scripts/build-release.js [--variant <name>] [--out <file>]');
  logger.log('');
  logger.log('Creates a production-ready release bundle containing compiled artifacts, configuration');
  logger.log('profiles, documentation, and operator tooling. The bundle is compressed into a tar.gz');
  logger.log('archive that non-technical operators can unpack and deploy immediately.');
  logger.log('');
  logger.log('Options:');
  logger.log('  --variant <name>   Configuration variant to embed (default: mainnet)');
  logger.log('  --out <file>       Destination archive path (default: dist/<bundle>.tar.gz)');
  logger.log('  --help             Show this message');
}

function readJson(filePath, { fsModule = fs } = {}) {
  const raw = fsModule.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function ensurePathExists(targetPath, { fsModule = fs, label }) {
  if (!fsModule.existsSync(targetPath)) {
    throw new Error(`${label || targetPath} does not exist. Run the prerequisite commands and try again.`);
  }
}

function safeGitRevParse({ cwd, execImpl = execFileSync }) {
  try {
    const output = execImpl('git', ['rev-parse', 'HEAD'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.toString('utf8').trim();
  } catch (error) {
    return null;
  }
}

function sanitizeTimestamp(value) {
  return value.replace(/[:.]/g, '-');
}

function collectManifest({
  projectRoot,
  variant,
  now = new Date(),
  fsModule = fs,
  execImpl = execFileSync,
}) {
  const packageJson = readJson(path.join(projectRoot, 'package.json'), { fsModule });
  const paramsPath = path.join(projectRoot, DEFAULT_PARAMS_RELATIVE);
  ensurePathExists(paramsPath, { fsModule, label: 'config/params.json' });
  const params = loadParams(paramsPath, { fsModule });

  const ensPath = path.join(projectRoot, 'config', `ens.${variant}.json`);
  ensurePathExists(ensPath, { fsModule, label: `config/ens.${variant}.json` });
  const ensConfig = readJson(ensPath, { fsModule });

  const tokenPath = path.join(projectRoot, 'config', `agialpha.${variant}.json`);
  ensurePathExists(tokenPath, { fsModule, label: `config/agialpha.${variant}.json` });
  const tokenConfig = readJson(tokenPath, { fsModule });

  const paramsSummary = formatSummary(params, params).split('\n');
  const gitCommit = safeGitRevParse({ cwd: projectRoot, execImpl });
  const timestamp = sanitizeTimestamp(now.toISOString());
  const bundleName = `agi-jobs-${variant}-${timestamp}`;

  return {
    name: packageJson.name || 'agijobsv1',
    version: packageJson.version || null,
    variant,
    createdAt: now.toISOString(),
    bundleName,
    gitCommit,
    params,
    paramsSummary,
    ensConfig,
    tokenConfig,
    sourcePaths: {
      params: path.relative(projectRoot, paramsPath),
      ens: path.relative(projectRoot, ensPath),
      token: path.relative(projectRoot, tokenPath),
    },
  };
}

function generateInstructions(manifest) {
  const lines = [];
  lines.push('# AGI Jobs Release Bundle');
  lines.push('');
  lines.push(`- Bundle: ${manifest.bundleName}`);
  lines.push(`- Created: ${manifest.createdAt}`);
  lines.push(`- Variant: ${manifest.variant}`);
  if (manifest.version) {
    lines.push(`- Version: ${manifest.version}`);
  }
  if (manifest.gitCommit) {
    lines.push(`- Git commit: ${manifest.gitCommit}`);
  } else {
    lines.push('- Git commit: not available');
  }
  lines.push('');
  lines.push('## Deployment checklist');
  lines.push('1. Install Node.js 20 and run `npm ci`.');
  lines.push('2. Review and optionally edit configuration under `config/`.');
  lines.push('   - `config/params.json` controls lifecycle timings and governance thresholds.');
  lines.push(`   - \`${manifest.sourcePaths.ens}\` manages ENS wiring.`);
  lines.push(`   - \`${manifest.sourcePaths.token}\` defines the staking token profile.`);
  lines.push('3. Run `npm run diagnose` to validate tooling and environment variables.');
  lines.push('4. Run `npm run config:validate` to confirm configuration guardrails.');
  lines.push('5. Dry-run JobRegistry configuration with `npm run configure:registry`.');
  lines.push('6. Use the owner console or Hardhat tasks to manage jobs once deployed.');
  lines.push('7. Archive the generated Safe transaction plan outputs for audit trails.');
  lines.push('');
  lines.push('## Parameter summary');
  lines.push('');
  manifest.paramsSummary.forEach((entry) => {
    lines.push(`- ${entry}`);
  });
  lines.push('');
  lines.push('## Support');
  lines.push('If anything looks unusual, re-run the bundle with updated configuration or consult `docs/` for');
  lines.push('detailed operational guides.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function copyDirectory({ fsModule = fs, source, destination, optional = false }) {
  if (!fsModule.existsSync(source)) {
    if (optional) {
      return false;
    }
    throw new Error(`Required directory missing: ${source}`);
  }
  fsModule.cpSync(source, destination, { recursive: true });
  return true;
}

function copyFile({ fsModule = fs, source, destination, optional = false }) {
  if (!fsModule.existsSync(source)) {
    if (optional) {
      return false;
    }
    throw new Error(`Required file missing: ${source}`);
  }
  fsModule.copyFileSync(source, destination);
  return true;
}

async function buildReleaseBundle({
  projectRoot = process.cwd(),
  variant = DEFAULT_VARIANT,
  outFile,
  fsModule = fs,
  osModule = os,
  pathModule = path,
  tarModule = tar,
  now = new Date(),
  execImpl = execFileSync,
} = {}) {
  const manifest = collectManifest({ projectRoot, variant, now, fsModule, execImpl });

  const artifactsDir = pathModule.join(projectRoot, 'artifacts-public');
  ensurePathExists(artifactsDir, { fsModule, label: 'artifacts-public' });

  const migrationsDir = pathModule.join(projectRoot, 'migrations');
  ensurePathExists(migrationsDir, { fsModule, label: 'migrations' });

  const scriptsDir = pathModule.join(projectRoot, 'scripts');
  ensurePathExists(scriptsDir, { fsModule, label: 'scripts' });

  const stagingRoot = fsModule.mkdtempSync(pathModule.join(osModule.tmpdir(), 'agijobs-release-'));
  const bundleRoot = pathModule.join(stagingRoot, manifest.bundleName);
  fsModule.mkdirSync(bundleRoot, { recursive: true });

  try {
    copyDirectory({ fsModule, source: artifactsDir, destination: pathModule.join(bundleRoot, 'artifacts') });
    copyDirectory({ fsModule, source: pathModule.join(projectRoot, 'config'), destination: pathModule.join(bundleRoot, 'config') });
    copyDirectory({ fsModule, source: migrationsDir, destination: pathModule.join(bundleRoot, 'migrations') });
    copyDirectory({ fsModule, source: scriptsDir, destination: pathModule.join(bundleRoot, 'scripts') });
    copyDirectory({ fsModule, source: pathModule.join(projectRoot, 'docs'), destination: pathModule.join(bundleRoot, 'docs'), optional: true });

    const filesToCopy = [
      'README.md',
      'SECURITY.md',
      'CHANGELOG.md',
      'LICENSE',
    ];
    filesToCopy.forEach((fileName) => {
      copyFile({
        fsModule,
        source: pathModule.join(projectRoot, fileName),
        destination: pathModule.join(bundleRoot, fileName),
        optional: fileName === 'CHANGELOG.md',
      });
    });

    const manifestPath = pathModule.join(bundleRoot, MANIFEST_FILENAME);
    fsModule.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const instructionsPath = pathModule.join(bundleRoot, INSTRUCTIONS_FILENAME);
    fsModule.writeFileSync(instructionsPath, generateInstructions(manifest), 'utf8');

    const resolvedOut = outFile
      ? pathModule.resolve(outFile)
      : pathModule.join(projectRoot, 'dist', `${manifest.bundleName}.tar.gz`);
    fsModule.mkdirSync(pathModule.dirname(resolvedOut), { recursive: true });

    await tarModule.create({ gzip: true, cwd: stagingRoot, file: resolvedOut }, [manifest.bundleName]);

    return { archivePath: resolvedOut, manifest };
  } finally {
    fsModule.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (args.help) {
    printHelp();
    return;
  }

  try {
    const { archivePath, manifest } = await buildReleaseBundle({
      variant: args.variant,
      outFile: args.outFile,
    });
    console.log(`Release bundle created: ${archivePath}`);
    console.log(`Bundle name: ${manifest.bundleName}`);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  printHelp,
  collectManifest,
  generateInstructions,
  buildReleaseBundle,
};
