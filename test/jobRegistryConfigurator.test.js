const { expect } = require('chai');

const {
  parseConfiguratorArgs,
  computeModulesPlan,
  computeTimingsPlan,
  computeThresholdsPlan,
  MODULE_KEYS,
  BPS_DENOMINATOR,
} = require('../scripts/lib/job-registry-configurator');

function buildAddress(hexDigit) {
  return `0x${hexDigit.repeat(40)}`;
}

function fillModules(startDigit) {
  return MODULE_KEYS.reduce((acc, key, index) => {
    const digit = ((parseInt(startDigit, 16) + index) % 16).toString(16);
    acc[key] = buildAddress(digit);
    return acc;
  }, {});
}

describe('job-registry-configurator library', () => {
  describe('parseConfiguratorArgs', () => {
    it('parses overrides, booleans, and ignores network flag', () => {
      const argv = [
        'node',
        'script',
        '--network',
        'development',
        '--modules.identity',
        '0x1234567890abcdef1234567890abcdef12345678',
        '--timings.commitWindow=7200',
        '--thresholds.feeBps',
        '300',
        '--execute',
        '--dry-run',
        'false',
        '--from',
        '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      ];

      const parsed = parseConfiguratorArgs(argv);
      expect(parsed.modules.identity).to.equal('0x1234567890abcdef1234567890abcdef12345678');
      expect(parsed.timings.commitWindow).to.equal('7200');
      expect(parsed.thresholds.feeBps).to.equal('300');
      expect(parsed.execute).to.be.true;
      expect(parsed.dryRun).to.be.false;
      expect(parsed.from).to.equal('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    });
  });

  describe('computeModulesPlan', () => {
    it('computes diffs across modules', () => {
      const current = fillModules('a');
      const defaults = fillModules('b');
      const overrides = {
        identity: '0x1111111111111111111111111111111111111111',
      };

      const plan = computeModulesPlan({ current, overrides, defaults });
      expect(plan.changed).to.be.true;
      expect(Object.keys(plan.diff)).to.include('identity');
      expect(plan.desired.identity).to.equal('0x1111111111111111111111111111111111111111');
      expect(plan.desired.staking).to.equal(defaults.staking.toLowerCase());
    });
  });

  describe('computeTimingsPlan', () => {
    it('uses overrides and defaults with validation', () => {
      const current = { commitWindow: 1000, revealWindow: 1000, disputeWindow: 2000 };
      const defaults = { commitWindow: 3600, revealWindow: 3600, disputeWindow: 7200 };
      const overrides = { revealWindow: '5400' };

      const plan = computeTimingsPlan({ current, overrides, defaults });
      expect(plan.desired.commitWindow).to.equal(defaults.commitWindow);
      expect(plan.desired.revealWindow).to.equal(5400);
      expect(plan.changed).to.be.true;
      expect(Object.keys(plan.diff)).to.include('revealWindow');
    });
  });

  describe('computeThresholdsPlan', () => {
    it('validates BPS bounds and quorum ordering', () => {
      const current = {
        approvalThresholdBps: 5000,
        quorumMin: 3,
        quorumMax: 9,
        feeBps: 150,
        slashBpsMax: 500,
      };
      const defaults = {
        approvalThresholdBps: BPS_DENOMINATOR,
        quorumMin: 3,
        quorumMax: 9,
        feeBps: 250,
        slashBpsMax: 1000,
      };
      const overrides = {
        quorumMax: '11',
        slashBpsMax: String(BPS_DENOMINATOR),
      };

      const plan = computeThresholdsPlan({ current, overrides, defaults });
      expect(plan.desired.quorumMax).to.equal(11);
      expect(plan.desired.slashBpsMax).to.equal(BPS_DENOMINATOR);
      expect(plan.changed).to.be.true;
      expect(Object.keys(plan.diff)).to.include('quorumMax');
    });

    it('rejects invalid quorum relationships', () => {
      const defaults = {
        approvalThresholdBps: 6000,
        quorumMin: 5,
        quorumMax: 10,
        feeBps: 200,
        slashBpsMax: 500,
      };

      expect(() =>
        computeThresholdsPlan({
          current: {},
          overrides: { quorumMin: '0' },
          defaults,
        })
      ).to.throw('thresholds.quorumMin must be greater than zero');

      expect(() =>
        computeThresholdsPlan({
          current: {},
          overrides: { quorumMin: '6', quorumMax: '5' },
          defaults,
        })
      ).to.throw('thresholds.quorumMax must be greater than or equal to thresholds.quorumMin');
    });

    it('rejects BPS above denominator', () => {
      const defaults = {
        approvalThresholdBps: 6000,
        quorumMin: 3,
        quorumMax: 9,
        feeBps: 250,
        slashBpsMax: 1000,
      };

      expect(() =>
        computeThresholdsPlan({
          current: {},
          overrides: { approvalThresholdBps: String(BPS_DENOMINATOR + 1) },
          defaults,
        })
      ).to.throw(`thresholds.approvalThresholdBps must not exceed ${BPS_DENOMINATOR}`);
    });
  });
});
