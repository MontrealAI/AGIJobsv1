const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  parseArgs,
  resolveBackupPath,
  coerceNumber,
  validateParams,
  findParamDefinition,
  formatSummary,
} = require('../scripts/edit-params');

const defaultParams = require('../config/params.json');

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

  it('supports human-friendly overrides and formatting helpers', () => {
    const commitDef = findParamDefinition('commitWindow');
    const feeDef = findParamDefinition('feeBps');
    const quorumDef = findParamDefinition('quorumMax');

    expect(coerceNumber('2h30m', 'commitWindow', commitDef)).to.equal(9000);
    expect(coerceNumber('90m', 'commitWindow', commitDef)).to.equal(5400);
    expect(coerceNumber('2.5%', 'feeBps', feeDef)).to.equal(250);
    expect(coerceNumber('1_000', 'quorumMax', quorumDef)).to.equal(1000);

    const updatedParams = {
      ...defaultParams,
      commitWindow: coerceNumber('8h', 'commitWindow', commitDef),
      revealWindow: coerceNumber('2h', 'revealWindow', findParamDefinition('revealWindow')),
      feeBps: coerceNumber('3%', 'feeBps', feeDef),
    };

    const errors = validateParams(updatedParams);
    expect(errors).to.deep.equal([]);

    const summary = formatSummary(defaultParams, updatedParams);
    expect(summary).to.include('commitWindow: 604800 (1w)');
    expect(summary).to.include('→ 28800 (8h)');
    expect(summary).to.include('feeBps: 250 bps (2.5%) → 300 bps (3%)');
  });

  it('rejects invalid temporal relationships during validation', () => {
    const candidate = {
      ...defaultParams,
      commitWindow: 3600,
      revealWindow: 3600,
      disputeWindow: 600,
    };

    const errors = validateParams(candidate);
    expect(errors).to.deep.include('revealWindow must be strictly less than commitWindow.');
  });
});
