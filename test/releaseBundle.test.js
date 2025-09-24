const fs = require('fs');
const os = require('os');
const path = require('path');
const tar = require('tar');
const { assert } = require('chai');

const {
  parseArgs,
  buildReleaseBundle,
} = require('../scripts/build-release');

describe('Release bundle builder', () => {
  it('parses CLI arguments with overrides', () => {
    const parsed = parseArgs(['--variant', 'sepolia', '--out', './bundle.tar.gz']);
    assert.strictEqual(parsed.variant, 'sepolia');
    assert.strictEqual(parsed.outFile, './bundle.tar.gz');
    assert.isFalse(parsed.help);

    const defaults = parseArgs([]);
    assert.strictEqual(defaults.variant, 'mainnet');
    assert.isNull(defaults.outFile);
  });

  it('creates an archive with manifest and instructions', async function () {
    this.timeout(20000);

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agijobs-release-test-'));
    const repoRoot = path.join(__dirname, '..');

    try {
      const artifactsDir = path.join(tmpRoot, 'artifacts-public');
      fs.mkdirSync(artifactsDir, { recursive: true });
      fs.writeFileSync(path.join(artifactsDir, 'placeholder.txt'), 'artifacts');

      ['config', 'scripts', 'migrations', 'docs'].forEach((dir) => {
        const source = path.join(repoRoot, dir);
        if (fs.existsSync(source)) {
          fs.cpSync(source, path.join(tmpRoot, dir), { recursive: true });
        }
      });

      assert.isTrue(
        fs.existsSync(path.join(tmpRoot, 'config', 'params.json')),
        'expected params.json to be copied into the temporary bundle root'
      );

      ['README.md', 'SECURITY.md', 'LICENSE', 'CHANGELOG.md', 'package.json', 'package-lock.json'].forEach((file) => {
        const source = path.join(repoRoot, file);
        if (fs.existsSync(source)) {
          fs.copyFileSync(source, path.join(tmpRoot, file));
        }
      });

      const outputPath = path.join(tmpRoot, 'bundle.tar.gz');
      const { archivePath, manifest } = await buildReleaseBundle({
        projectRoot: tmpRoot,
        variant: 'mainnet',
        outFile: outputPath,
      });

      assert.strictEqual(archivePath, outputPath);
      assert.isTrue(fs.existsSync(archivePath), 'expected archive to exist');
      assert.strictEqual(manifest.variant, 'mainnet');
      assert.isArray(manifest.paramsSummary);
      assert.isAbove(manifest.paramsSummary.length, 0);

      const extractionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agijobs-release-unpack-'));
      try {
        await tar.x({ file: archivePath, cwd: extractionDir });
        const entries = fs.readdirSync(extractionDir);
        assert.strictEqual(entries.length, 1, 'archive should contain a single bundle directory');
        const bundleDir = path.join(extractionDir, entries[0]);

        const manifestPath = path.join(bundleDir, 'release-manifest.json');
        const instructionsPath = path.join(bundleDir, 'INSTRUCTIONS.md');
        assert.isTrue(fs.existsSync(manifestPath));
        assert.isTrue(fs.existsSync(instructionsPath));

        const manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        assert.strictEqual(manifestData.variant, 'mainnet');
        assert.deepEqual(manifestData.params, manifest.params);

        const instructions = fs.readFileSync(instructionsPath, 'utf8');
        assert.include(instructions, 'AGI Jobs Release Bundle');
        assert.include(instructions, 'Deployment checklist');

        ['artifacts', 'config', 'migrations', 'scripts'].forEach((dir) => {
          assert.isTrue(fs.existsSync(path.join(bundleDir, dir)), `expected ${dir} directory`);
        });
      } finally {
        fs.rmSync(extractionDir, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
