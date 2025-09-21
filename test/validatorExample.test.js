const path = require('path');
const { spawnSync } = require('child_process');

contract('Validator CLI example', () => {
  it('prints help when invoked without a command', () => {
    const scriptPath = path.join(__dirname, '..', 'examples', 'v2-validator.js');
    const result = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });

    assert.strictEqual(result.status, 0, result.stderr || 'expected zero exit code');
    assert.include(result.stdout, 'Usage: node v2-validator.js', 'help banner missing');
    assert.include(result.stdout, 'rule:set <rule> <enabled>', 'rule command missing');
  });
});
