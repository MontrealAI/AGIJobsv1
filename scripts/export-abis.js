const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function resolveTruffleBinary() {
  const binName = process.platform === 'win32' ? 'truffle.cmd' : 'truffle';
  const localBin = path.join(__dirname, '..', 'node_modules', '.bin', binName);
  if (fs.existsSync(localBin)) {
    return { command: localBin, args: [] };
  }

  return { command: 'npx', args: ['truffle'] };
}

function hasArtifacts(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return false;
  }

  return fs.readdirSync(dirPath).some((file) => file.endsWith('.json'));
}

function compileArtifacts(buildDir) {
  const { command, args } = resolveTruffleBinary();
  const compileArgs = args.concat(['compile']);
  const display = [command, ...compileArgs].join(' ');
  console.log(`Truffle artifacts missing at ${buildDir}; running '${display}'...`);

  const result = spawnSync(command, compileArgs, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    throw new Error(`Failed to compile contracts for ABI export (exit code ${result.status}).`);
  }

  if (!hasArtifacts(buildDir)) {
    throw new Error(`Truffle compile completed but artifacts still missing at ${buildDir}.`);
  }
}

function ensureArtifacts(buildDir) {
  if (hasArtifacts(buildDir)) {
    return;
  }

  if (process.env.EXPORT_ABIS_SKIP_COMPILE === 'true') {
    throw new Error(`Truffle artifacts not found at ${buildDir}. Run 'npm run build' first.`);
  }

  compileArtifacts(buildDir);
}

function resolveBuildDir(customDir) {
  if (customDir) {
    return customDir;
  }
  return path.join(__dirname, '..', 'build', 'contracts');
}

function resolveOutputDir(customDir) {
  if (customDir) {
    return customDir;
  }
  return path.join(__dirname, '..', 'artifacts-public', 'abis');
}

function ensureDirectory(dirPath) {
  if (fs.existsSync(dirPath)) {
    return;
  }
  fs.mkdirSync(dirPath, { recursive: true });
}

function cleanDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return;
  }
  for (const entry of fs.readdirSync(dirPath)) {
    fs.rmSync(path.join(dirPath, entry), { recursive: true, force: true });
  }
}

function sanitizeArtifact(artifact) {
  const { contractName, abi, bytecode, deployedBytecode, sourceName, sourcePath } = artifact;
  if (!contractName || !Array.isArray(abi)) {
    return null;
  }

  const sanitized = {
    contractName,
    abi,
  };

  const resolvedSource = sourceName || sourcePath;
  if (resolvedSource) {
    sanitized.sourceName = resolvedSource;
  }

  if (typeof bytecode === 'string' && bytecode !== '0x' && bytecode.length > 2) {
    sanitized.bytecode = bytecode;
  }

  if (
    typeof deployedBytecode === 'string' &&
    deployedBytecode !== '0x' &&
    deployedBytecode.length > 2
  ) {
    sanitized.deployedBytecode = deployedBytecode;
  }

  return sanitized;
}

function exportAbis({ buildDir: customBuildDir, outputDir: customOutputDir } = {}) {
  const buildDir = resolveBuildDir(customBuildDir);
  const outputDir = resolveOutputDir(customOutputDir);

  ensureArtifacts(buildDir);

  ensureDirectory(path.dirname(outputDir));
  ensureDirectory(outputDir);
  cleanDirectory(outputDir);

  const exported = [];
  const entries = fs
    .readdirSync(buildDir)
    .filter((file) => file.endsWith('.json'))
    .sort();

  for (const file of entries) {
    const artifactPath = path.join(buildDir, file);
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const sanitized = sanitizeArtifact(artifact);
    if (!sanitized) {
      continue;
    }

    const targetPath = path.join(outputDir, `${sanitized.contractName}.json`);
    fs.writeFileSync(targetPath, JSON.stringify(sanitized, null, 2));
    exported.push(sanitized.contractName);
  }

  exported.sort();

  const manifest = {
    generatedAt: new Date().toISOString(),
    contracts: exported,
  };
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  return {
    buildDir,
    outputDir,
    exported,
  };
}

async function main() {
  const result = exportAbis();
  console.log(`Exported ${result.exported.length} ABIs to ${result.outputDir}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { exportAbis };
