const { expect } = require('chai');

const {
  ACTIONS,
  MODULE_ENUM,
  TIMING_ENUM,
  THRESHOLD_ENUM,
  parseConfigConsoleArgs,
  buildSetPlans,
  buildUpdatePlan,
} = require('../scripts/lib/job-registry-config-console');
const {
  MODULE_KEYS,
  TIMING_KEYS,
  THRESHOLD_KEYS,
  BPS_DENOMINATOR,
} = require('../scripts/lib/job-registry-configurator');

function addressOf(hexDigit) {
  return `0x${hexDigit.repeat(40)}`;
}

function fillModules(startDigit) {
  return MODULE_KEYS.reduce((acc, key, index) => {
    const digit = ((parseInt(startDigit, 16) + index) % 16).toString(16);
    acc[key] = addressOf(digit);
    return acc;
  }, {});
}

describe('job-registry-config-console library', () => {
  it('parses console arguments with action detection and overrides', () => {
    const argv = [
      'node',
      'script.js',
      '--from',
      '0x1234567890abcdef1234567890abcdef12345678',
      '--execute=false',
      '--timings.commitWindow',
      '7200',
      'update',
    ];

    const parsed = parseConfigConsoleArgs(argv);
    expect(parsed.action).to.equal(ACTIONS.UPDATE);
    expect(parsed.from).to.equal('0x1234567890abcdef1234567890abcdef12345678');
    expect(parsed.execute).to.be.false;
    expect(parsed.timings.commitWindow).to.equal('7200');
  });

  it('builds set plans using overrides and defaults', () => {
    const currentModules = fillModules('1');
    const overrides = {
      modules: { ...MODULE_KEYS.reduce((acc, key) => ((acc[key] = undefined), acc), {}), identity: addressOf('a') },
      timings: { commitWindow: '9000' },
      thresholds: { feeBps: '300' },
    };
    const defaults = {
      modules: fillModules('2'),
      timings: { commitWindow: 3600, revealWindow: 3600, disputeWindow: 7200 },
      thresholds: {
        approvalThresholdBps: 6000,
        quorumMin: 3,
        quorumMax: 11,
        feeBps: 250,
        slashBpsMax: 2000,
      },
    };

    const plans = buildSetPlans({
      currentModules,
      currentTimings: { commitWindow: 3600, revealWindow: 3600, disputeWindow: 7200 },
      currentThresholds: {
        approvalThresholdBps: 6000,
        quorumMin: 3,
        quorumMax: 11,
        feeBps: 250,
        slashBpsMax: 2000,
      },
      overrides,
      defaults,
    });

    expect(plans.modulesPlan.changed).to.be.true;
    expect(plans.modulesPlan.desired.identity).to.equal(addressOf('a'));
    expect(plans.timingsPlan.desired.commitWindow).to.equal(9000);
    expect(plans.thresholdsPlan.desired.feeBps).to.equal(300);
  });

  it('builds module update plan with normalization and diff reporting', () => {
    const overrides = {
      modules: { identity: addressOf('b') },
      timings: {},
      thresholds: {},
    };
    const plan = buildUpdatePlan({
      overrides,
      currentModules: fillModules('1'),
      currentTimings: {},
      currentThresholds: {
        approvalThresholdBps: 6000,
        quorumMin: 3,
        quorumMax: 11,
        feeBps: 250,
        slashBpsMax: 2000,
      },
    });

    expect(plan.method).to.equal('updateModule');
    expect(plan.args[0]).to.equal(MODULE_ENUM.identity);
    expect(plan.summary.next).to.equal(addressOf('b'));
  });

  it('builds timing update plan enforcing positive integers', () => {
    const overrides = {
      modules: {},
      timings: { revealWindow: '5400' },
      thresholds: {},
    };

    const plan = buildUpdatePlan({
      overrides,
      currentModules: fillModules('1'),
      currentTimings: { commitWindow: 3600, revealWindow: 3600, disputeWindow: 7200 },
      currentThresholds: {
        approvalThresholdBps: 6000,
        quorumMin: 3,
        quorumMax: 11,
        feeBps: 250,
        slashBpsMax: 2000,
      },
    });

    expect(plan.method).to.equal('updateTiming');
    expect(plan.args[0]).to.equal(TIMING_ENUM.revealWindow);
    expect(plan.summary.next).to.equal(5400);
  });

  it('builds threshold update plan with BPS validation', () => {
    const overrides = {
      modules: {},
      timings: {},
      thresholds: { feeBps: String(BPS_DENOMINATOR) },
    };

    const plan = buildUpdatePlan({
      overrides,
      currentModules: fillModules('1'),
      currentTimings: { commitWindow: 3600, revealWindow: 3600, disputeWindow: 7200 },
      currentThresholds: {
        approvalThresholdBps: 6000,
        quorumMin: 3,
        quorumMax: 11,
        feeBps: 250,
        slashBpsMax: 2000,
      },
    });

    expect(plan.method).to.equal('updateThreshold');
    expect(plan.args[0]).to.equal(THRESHOLD_ENUM.feeBps);
    expect(plan.summary.next).to.equal(BPS_DENOMINATOR);
  });

  it('rejects multiple overrides for update action', () => {
    const overrides = {
      modules: { identity: addressOf('a') },
      timings: { commitWindow: '7200' },
      thresholds: {},
    };

    expect(() =>
      buildUpdatePlan({
        overrides,
        currentModules: fillModules('1'),
        currentTimings: { commitWindow: 3600, revealWindow: 3600, disputeWindow: 7200 },
        currentThresholds: {
          approvalThresholdBps: 6000,
          quorumMin: 3,
          quorumMax: 11,
          feeBps: 250,
          slashBpsMax: 2000,
        },
      })
    ).to.throw('Update action accepts only one override');
  });

  it('rejects quorumMin values above quorumMax', () => {
    const overrides = {
      modules: {},
      timings: {},
      thresholds: { quorumMin: '12' },
    };

    expect(() =>
      buildUpdatePlan({
        overrides,
        currentModules: fillModules('1'),
        currentTimings: { commitWindow: 3600, revealWindow: 3600, disputeWindow: 7200 },
        currentThresholds: {
          approvalThresholdBps: 6000,
          quorumMin: 3,
          quorumMax: 11,
          feeBps: 250,
          slashBpsMax: 2000,
        },
      })
    ).to.throw('thresholds.quorumMin (12) must not exceed the current quorumMax (11)');
  });
});
