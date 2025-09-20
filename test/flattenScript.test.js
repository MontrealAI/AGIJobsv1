const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

contract('Flatten script automation', () => {
  it('flattens core contracts into structured outputs', function () {
    this.timeout(300000);

    const flatDir = path.join(__dirname, '..', 'artifacts-public', 'flat');
    if (fs.existsSync(flatDir)) {
      fs.rmSync(flatDir, { recursive: true, force: true });
    }
    fs.mkdirSync(flatDir, { recursive: true });

    execFileSync('bash', ['scripts/flatten.sh'], { stdio: 'inherit' });

    const stakeManagerFlat = path.join(flatDir, 'core', 'StakeManager.flat.sol');
    assert.isTrue(fs.existsSync(stakeManagerFlat), 'StakeManager flat artifact missing');
    const content = fs.readFileSync(stakeManagerFlat, 'utf8');
    assert.match(
      content,
      /contract\s+StakeManager/,
      'flattened StakeManager should contain contract source'
    );

    const libsDir = path.join(flatDir, 'libs');
    assert.isFalse(fs.existsSync(libsDir), 'library directories should be skipped');
  });
});
