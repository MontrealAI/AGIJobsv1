const fs = require('fs');
const os = require('os');
const path = require('path');
const { exportAbis } = require('../scripts/export-abis');

contract('Artifacts export automation', () => {
  it('creates sanitized ABI bundle and manifest', async function () {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agijobs-abis-'));
    const staleFile = path.join(tmpDir, 'stale.json');
    fs.writeFileSync(staleFile, '{}');

    try {
      const result = exportAbis({ outputDir: tmpDir });
      assert.isAbove(result.exported.length, 0, 'no ABI files exported');
      assert.includeMembers(
        result.exported,
        ['JobRegistry', 'StakeManager', 'IdentityRegistry'],
        'core contracts missing from export'
      );

      const exportedFiles = fs.readdirSync(tmpDir);
      assert.notInclude(exportedFiles, 'stale.json', 'stale files should be removed');
      assert.isTrue(
        fs.existsSync(path.join(tmpDir, 'JobRegistry.json')),
        'expected JobRegistry ABI file'
      );

      const manifestPath = path.join(tmpDir, 'manifest.json');
      assert.isTrue(fs.existsSync(manifestPath), 'manifest.json should be generated');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      assert.deepEqual(manifest.contracts, result.exported, 'manifest should mirror exported list');
      assert.isString(manifest.generatedAt, 'manifest timestamp missing');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
