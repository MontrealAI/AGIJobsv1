const { expect } = require('chai');
const { hash: namehash } = require('eth-ens-namehash');

const {
  ACTIONS,
  parseIdentityConsoleArgs,
  deriveDesiredConfig,
  buildSetPlan,
  formatPlanLines,
  formatStatusLines,
} = require('../scripts/lib/identity-registry-console');

function addressOf(digit) {
  return `0x${digit.repeat(40)}`;
}

function hashOf(digit) {
  return `0x${digit.repeat(64)}`;
}

describe('identity-registry-console library', () => {
  it('parses CLI arguments with overrides and execution flags', () => {
    const argv = [
      'node',
      'script.js',
      '--from',
      addressOf('1'),
      '--execute=false',
      '--ens.registry',
      addressOf('a'),
      '--ens.alphaEnabled=true',
      'set',
    ];

    const parsed = parseIdentityConsoleArgs(argv);
    expect(parsed.action).to.equal(ACTIONS.SET);
    expect(parsed.from).to.equal(addressOf('1'));
    expect(parsed.execute).to.be.false;
    expect(parsed.overrides.registry).to.equal(addressOf('a'));
    expect(parsed.overrides.alphaEnabled).to.equal('true');
  });

  it('derives desired configuration from base config and overrides', () => {
    const clubHash = namehash('club.agi.eth');
    const alphaHash = namehash('alpha.club.agi.eth');

    const desired = deriveDesiredConfig(
      {
        registry: addressOf('2'),
        nameWrapper: '',
        agentRoot: 'Agent.AGI.eth',
        clubRootHash: clubHash,
        alphaClubRoot: 'Alpha.Club.AGI.eth',
        alphaEnabled: true,
      },
      {
        nameWrapper: addressOf('3'),
        agentRootHash: hashOf('b'),
        alphaEnabled: 'false',
      }
    );

    expect(desired.registry).to.equal(addressOf('2'));
    expect(desired.nameWrapper).to.equal(addressOf('3'));
    expect(desired.agentRootHash).to.equal(hashOf('b'));
    expect(desired.clubRootHash).to.equal(clubHash);
    expect(desired.alphaClubRootHash).to.equal(alphaHash);
    expect(desired.alphaEnabled).to.be.false;
  });

  it('throws when required ENS parameters are missing', () => {
    expect(() =>
      deriveDesiredConfig(
        {
          registry: null,
          nameWrapper: '',
          agentRoot: 'agent.agi.eth',
          clubRoot: 'club.agi.eth',
        },
        {}
      )
    ).to.throw('IdentityRegistry.configureEns requires a non-zero registry address');
  });

  it('builds set plan diffs and arguments for configureEns', () => {
    const agentHash = namehash('agent.agi.eth');
    const clubHash = namehash('club.agi.eth');
    const alphaHash = namehash('alpha.club.agi.eth');

    const plan = buildSetPlan({
      current: {
        registry: addressOf('4'),
        nameWrapper: null,
        agentRootHash: agentHash,
        clubRootHash: clubHash,
        alphaClubRootHash: null,
        alphaEnabled: false,
      },
      baseConfig: {
        registry: addressOf('4'),
        nameWrapper: null,
        agentRoot: 'agent.agi.eth',
        clubRoot: 'club.agi.eth',
        alphaClubRoot: 'alpha.club.agi.eth',
        alphaEnabled: false,
      },
      overrides: {
        alphaEnabled: 'true',
      },
    });

    expect(plan.changed).to.be.true;
    expect(plan.args).to.deep.equal([
      addressOf('4'),
      '0x0000000000000000000000000000000000000000',
      agentHash,
      clubHash,
      alphaHash,
      true,
    ]);
    expect(plan.diff).to.have.property('alphaClubRootHash');
    expect(plan.diff.alphaClubRootHash.next).to.equal(alphaHash);
    expect(plan.diff.alphaEnabled.next).to.be.true;

    const planLines = formatPlanLines(plan);
    expect(planLines[0]).to.include('Planned IdentityRegistry.configureEns update');
    expect(planLines).to.include(`  alphaClubRootHash: (unset) -> ${alphaHash}`);
    expect(planLines).to.include('  alphaEnabled: false -> true');
  });

  it('formats current status with unset markers', () => {
    const agentHash = namehash('agent.agi.eth');
    const clubHash = namehash('club.agi.eth');

    const lines = formatStatusLines({
      registry: addressOf('5'),
      nameWrapper: null,
      agentRootHash: agentHash,
      clubRootHash: clubHash,
      alphaClubRootHash: null,
      alphaEnabled: false,
    });

    expect(lines).to.deep.equal([
      'On-chain IdentityRegistry configuration:',
      `  registry: ${addressOf('5')}`,
      '  nameWrapper: (unset)',
      `  agentRootHash: ${agentHash}`,
      `  clubRootHash: ${clubHash}`,
      '  alphaClubRootHash: (unset)',
      '  alphaEnabled: false',
    ]);
  });
});
