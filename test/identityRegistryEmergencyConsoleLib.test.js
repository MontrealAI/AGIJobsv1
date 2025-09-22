const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');

const IdentityRegistry = artifacts.require('IdentityRegistry');

const {
  ACTIONS,
  parseEmergencyConsoleArgs,
  resolveCheckAddresses,
  resolveModificationEntries,
  formatStatusLines,
  formatPlanLines,
  collectEmergencyStatus,
  buildEmergencyPlanEntries,
  enrichPlanEntriesWithCalldata,
  buildPlanSummary,
  writePlanSummary,
} = require('../scripts/lib/identity-registry-emergency');

function addressOf(digit) {
  return `0x${digit.repeat(40)}`;
}

function temporaryFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-emergency-test-'));
  const filePath = path.join(dir, 'input.txt');
  fs.writeFileSync(filePath, contents, 'utf8');
  return filePath;
}

describe('identity-registry-emergency library', () => {
  it('parses CLI arguments for status and set actions', () => {
    const argv = [
      'node',
      'script.js',
      '--from',
      addressOf('1'),
      '--plan-out',
      './plan.json',
      '--allow',
      `${addressOf('2')},${addressOf('3')}`,
      '--revoke',
      addressOf('4'),
      '--batch',
      JSON.stringify([{ address: addressOf('5'), allowed: false }]),
      '--batch-file',
      './batch.txt',
      'set',
    ];

    const parsed = parseEmergencyConsoleArgs(argv);
    expect(parsed.action).to.equal(ACTIONS.SET);
    expect(parsed.from).to.equal(addressOf('1'));
    expect(parsed.planOut).to.equal('./plan.json');
    expect(parsed.allow).to.deep.equal([`${addressOf('2')},${addressOf('3')}`]);
    expect(parsed.revoke).to.deep.equal([addressOf('4')]);
    expect(parsed.batch).to.have.lengthOf(1);
    expect(parsed.batchFile).to.equal('./batch.txt');
  });

  it('resolves check addresses from inline values and files', () => {
    const filePath = temporaryFile(`${addressOf('a')}\n${addressOf('b')}\n`);
    const addresses = resolveCheckAddresses({
      inline: [addressOf('c'), `${addressOf('d')},${addressOf('e')}`],
      filePath,
    });

    expect(addresses).to.deep.equal([
      addressOf('c').toLowerCase(),
      addressOf('d').toLowerCase(),
      addressOf('e').toLowerCase(),
      addressOf('a').toLowerCase(),
      addressOf('b').toLowerCase(),
    ]);
  });

  it('resolves modification entries from multiple sources', () => {
    const batchPath = temporaryFile(`${addressOf('7')} allow\n${addressOf('8')} false\n`);
    const entries = resolveModificationEntries({
      allowList: [`${addressOf('1')},${addressOf('2')}`],
      revokeList: [addressOf('3')],
      batch: [{ address: addressOf('4'), allowed: true }],
      filePath: batchPath,
    });

    expect(entries).to.deep.equal([
      { address: addressOf('1').toLowerCase(), allowed: true },
      { address: addressOf('2').toLowerCase(), allowed: true },
      { address: addressOf('3').toLowerCase(), allowed: false },
      { address: addressOf('4').toLowerCase(), allowed: true },
      { address: addressOf('7').toLowerCase(), allowed: true },
      { address: addressOf('8').toLowerCase(), allowed: false },
    ]);
  });

  it('formats status and plan lines', () => {
    const statusLines = formatStatusLines([
      { address: addressOf('1'), allowed: true },
      { address: addressOf('2'), allowed: false },
    ]);
    expect(statusLines[0]).to.equal('Emergency access status:');
    expect(statusLines).to.satisfy((lines) => lines.some((line) => line.includes('allowed')));

    const planLines = formatPlanLines([
      { address: addressOf('3'), allowed: true },
      { address: addressOf('4'), allowed: false },
    ]);
    expect(planLines[0]).to.equal('Planned IdentityRegistry.setEmergencyAccess updates:');
    expect(planLines).to.include(`  - allow ${addressOf('3')}`);
    expect(planLines).to.include(`  - revoke ${addressOf('4')}`);
  });
});

contract('IdentityRegistry emergency library integration', (accounts) => {
  const [owner, other] = accounts;

  beforeEach(async function () {
    this.registry = await IdentityRegistry.new({ from: owner });
  });

  it('collects emergency status from the contract', async function () {
    await this.registry.setEmergencyAccess(other, true, { from: owner });
    const status = await collectEmergencyStatus(this.registry, [other]);
    expect(status).to.deep.equal([{ address: other.toLowerCase(), allowed: true }]);
  });

  it('builds calldata-enriched plan entries and summaries', async function () {
    const modifications = [
      { address: other.toLowerCase(), allowed: true },
      { address: owner.toLowerCase(), allowed: false },
    ];

    const planEntries = buildEmergencyPlanEntries(modifications);
    expect(planEntries).to.have.lengthOf(2);
    expect(planEntries[0].args).to.deep.equal([other.toLowerCase(), true]);

    const enriched = enrichPlanEntriesWithCalldata(this.registry, planEntries);
    expect(enriched[0]).to.have.property('callData');
    expect(enriched[0].call).to.deep.equal({ to: this.registry.address, data: enriched[0].callData, value: '0' });

    const summary = buildPlanSummary({
      identityAddress: this.registry.address,
      owner,
      sender: owner,
      planEntries: enriched,
    });

    expect(summary.identityRegistry).to.equal(this.registry.address);
    expect(summary.steps).to.have.lengthOf(2);
    expect(summary.steps[0].action).to.equal('allow');

    const outPath = path.join(os.tmpdir(), `agi-emergency-summary-${Date.now()}.json`);
    const written = writePlanSummary(summary, outPath);
    expect(fs.existsSync(written)).to.be.true;
    const persisted = JSON.parse(fs.readFileSync(written, 'utf8'));
    expect(persisted.steps[0].address.toLowerCase()).to.equal(other.toLowerCase());
  });
});
