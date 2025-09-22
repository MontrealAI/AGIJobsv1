const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  parseArgs,
  resolveBackupPath,
} = require('../scripts/edit-params');

function createTempDir(prefix) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return base;
}

describe('params editor CLI', () => {
  it('parses inline overrides and backup flags', () => {
    const inline = parseArgs([
      'node',
      'script',
      '--set=feeBps=300',
      '--backup',
      '--no-interactive',
    ]);
    expect(inline.set).to.deep.equal({ feeBps: '300' });
    expect(inline.backup).to.equal(true);
    expect(inline.interactive).to.be.false;

    const custom = parseArgs([
      'node',
      'script',
      '--backup',
      './params.backup.json',
      '--set',
      'quorumMin=5',
    ]);
    expect(custom.backup).to.equal(path.resolve('./params.backup.json'));
    expect(custom.set).to.deep.equal({ quorumMin: '5' });

    const disabled = parseArgs(['node', 'script', '--backup=false']);
    expect(disabled.backup).to.be.false;
  });

  it('resolves automatic backup paths with sanitized timestamps', () => {
    const now = new Date('2024-01-02T03:04:05.678Z');
    const resolved = resolveBackupPath('/tmp/params.json', true, { now });
    expect(resolved).to.equal('/tmp/params.json.2024-01-02T03-04-05-678Z.bak');

    const explicit = resolveBackupPath('/tmp/params.json', 'custom/backup.bak');
    expect(explicit).to.equal(path.resolve('custom/backup.bak'));
  });

  it('creates a timestamped backup when invoked with --backup', () => {
    const tmpDir = createTempDir('params-editor-');

    try {
      const target = path.join(tmpDir, 'params.json');
      const original = JSON.parse(JSON.stringify(require('../config/params.json')));
      fs.writeFileSync(target, `${JSON.stringify(original, null, 2)}\n`, 'utf8');

      const scriptPath = path.join(__dirname, '..', 'scripts', 'edit-params.js');
      execFileSync('node', [
        scriptPath,
        '--file',
        target,
        '--set',
        'feeBps=100',
        '--yes',
        '--no-interactive',
        '--backup',
      ]);

      const files = fs.readdirSync(tmpDir);
      const backupName = files.find((name) => name.endsWith('.bak'));
      expect(backupName).to.exist;

      const backupValues = JSON.parse(fs.readFileSync(path.join(tmpDir, backupName), 'utf8'));
      expect(backupValues.feeBps).to.equal(original.feeBps);

      const updatedValues = JSON.parse(fs.readFileSync(target, 'utf8'));
      expect(updatedValues.feeBps).to.equal(100);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
