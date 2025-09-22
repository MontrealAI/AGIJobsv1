'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DEFAULT_PARAMS_PATH = path.join(__dirname, '..', 'config', 'params.json');

const PARAM_DEFINITIONS = [
  {
    key: 'commitWindow',
    label: 'Commit window (seconds)',
    description: 'Time allowed for workers to commit job results before revealing.',
    minimum: 60,
    maximum: null,
  },
  {
    key: 'revealWindow',
    label: 'Reveal window (seconds)',
    description:
      'Duration for workers to reveal commitments. Should be shorter than the commit window.',
    minimum: 60,
    maximum: null,
  },
  {
    key: 'disputeWindow',
    label: 'Dispute window (seconds)',
    description: 'Period during which disputes can be raised after reveal.',
    minimum: 60,
    maximum: null,
  },
  {
    key: 'approvalThresholdBps',
    label: 'Approval threshold (basis points)',
    description: 'Percentage of approvals required (out of 10,000).',
    minimum: 0,
    maximum: 10000,
  },
  {
    key: 'quorumMin',
    label: 'Minimum quorum',
    description: 'Minimum number of reviewers required.',
    minimum: 1,
    maximum: null,
  },
  {
    key: 'quorumMax',
    label: 'Maximum quorum',
    description: 'Maximum number of reviewers that can participate.',
    minimum: 1,
    maximum: null,
  },
  {
    key: 'feeBps',
    label: 'Protocol fee (basis points)',
    description: 'Fee retained by the protocol per job (out of 10,000).',
    minimum: 0,
    maximum: 10000,
  },
  {
    key: 'slashBpsMax',
    label: 'Maximum slash (basis points)',
    description: 'Maximum percentage of stake that can be slashed per dispute.',
    minimum: 0,
    maximum: 10000,
  },
];

function parseArgs(argv) {
  const args = {
    file: DEFAULT_PARAMS_PATH,
    set: {},
    dryRun: false,
    yes: false,
    help: false,
    interactive: null,
    backup: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];

    if (current === '--help' || current === '-h') {
      args.help = true;
      continue;
    }

    if (current === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    if (current === '--yes' || current === '--force') {
      args.yes = true;
      continue;
    }

    if (current === '--file') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('--file requires a path argument');
      }
      args.file = path.resolve(next);
      i += 1;
      continue;
    }

    if (current === '--interactive') {
      args.interactive = true;
      continue;
    }

    if (current === '--no-interactive') {
      args.interactive = false;
      continue;
    }

    if (current === '--backup') {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args.backup = normalizeBackupOption(next);
        i += 1;
      } else {
        args.backup = true;
      }
      continue;
    }

    if (current === '--no-backup') {
      args.backup = false;
      continue;
    }

    if (current.startsWith('--backup=')) {
      const assignment = current.slice('--backup='.length);
      args.backup = normalizeBackupOption(assignment);
      continue;
    }

    if (current.startsWith('--set')) {
      let assignment;
      if (current === '--set') {
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
          throw new Error('--set requires key=value');
        }
        assignment = next;
        i += 1;
      } else {
        const eqIndex = current.indexOf('=');
        if (eqIndex === -1) {
          throw new Error('--set requires key=value');
        }
        assignment = current.slice(eqIndex + 1);
        if (!assignment) {
          const next = argv[i + 1];
          if (!next || next.startsWith('--')) {
            throw new Error('--set requires key=value');
          }
          assignment = next;
          i += 1;
        }
      }

      const separatorIndex = assignment.indexOf('=');
      if (separatorIndex === -1) {
        throw new Error(`Invalid --set assignment "${assignment}". Expected key=value.`);
      }

      const key = assignment.slice(0, separatorIndex).trim();
      const value = assignment.slice(separatorIndex + 1).trim();
      if (!key || value === undefined) {
        throw new Error(`Invalid --set assignment "${assignment}". Expected key=value.`);
      }
      args.set[key] = value;
      continue;
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  return args;
}

function normalizeBackupOption(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return true;
  }

  if (rawValue === true || rawValue === false) {
    return rawValue;
  }

  const trimmed = String(rawValue).trim();
  if (trimmed.length === 0) {
    return true;
  }

  const normalized = trimmed.toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  return path.resolve(trimmed);
}

function printHelp() {
  console.log('AGIJobsv1 — params editor');
  console.log('Usage: node scripts/edit-params.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --file <path>         Path to params JSON (defaults to config/params.json)');
  console.log('  --set key=value       Override a parameter without prompting (repeatable)');
  console.log('  --dry-run             Print resulting JSON without writing to disk');
  console.log('  --yes                 Skip the confirmation prompt and accept changes');
  console.log('  --interactive         Force interactive prompts even when using --set');
  console.log('  --no-interactive      Disable prompts; only apply explicit --set overrides');
  console.log('  --backup[=<path>]     Save a backup before writing (optional custom path)');
  console.log('  --no-backup           Skip creating a backup even if --backup was provided');
  console.log('  --help                Display this help message');
}

function loadParams(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Params file not found at ${resolvedPath}`);
  }

  const raw = fs.readFileSync(resolvedPath, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (error) {
    throw new Error(`Unable to parse JSON at ${resolvedPath}: ${error.message}`);
  }
}

function coerceNumber(value, key) {
  if (value === '' || value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid numeric value for ${key}: ${value}`);
    }
    return parsed;
  }

  throw new Error(`Invalid value for ${key}: ${value}`);
}

function validateParams(candidate) {
  const errors = [];

  PARAM_DEFINITIONS.forEach((definition) => {
    const value = candidate[definition.key];

    if (value === undefined) {
      errors.push(`Missing value for ${definition.key}.`);
      return;
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`Value for ${definition.key} must be a finite number.`);
      return;
    }

    if (!Number.isInteger(value)) {
      errors.push(`Value for ${definition.key} must be an integer.`);
      return;
    }

    if (definition.minimum !== null && value < definition.minimum) {
      errors.push(`${definition.key} must be greater than or equal to ${definition.minimum}.`);
    }

    if (definition.maximum !== null && value > definition.maximum) {
      errors.push(`${definition.key} must be less than or equal to ${definition.maximum}.`);
    }
  });

  const { quorumMin, quorumMax } = candidate;
  if (
    typeof quorumMin === 'number' &&
    typeof quorumMax === 'number' &&
    Number.isFinite(quorumMin) &&
    Number.isFinite(quorumMax) &&
    quorumMin > quorumMax
  ) {
    errors.push('quorumMin must be less than or equal to quorumMax.');
  }

  const { approvalThresholdBps } = candidate;
  if (typeof approvalThresholdBps === 'number' && Number.isFinite(approvalThresholdBps)) {
    const quorumFloor = quorumMin || 0;
    if (approvalThresholdBps > 0 && quorumFloor === 0) {
      errors.push('approvalThresholdBps > 0 requires quorumMin to be at least 1.');
    }
  }

  return errors;
}

async function promptUser(definition, currentValue, rl) {
  const questionParts = [
    `${definition.label}`,
    `Current value: ${currentValue}`,
    definition.description ? definition.description : null,
    definition.minimum !== null ? `Minimum: ${definition.minimum}` : null,
    definition.maximum !== null ? `Maximum: ${definition.maximum}` : null,
  ].filter(Boolean);

  const prompt = `${questionParts.join('\n')}\n> `;

  const answer = await new Promise((resolve) => {
    rl.question(prompt, (response) => {
      resolve(response.trim());
    });
  });

  if (answer === '') {
    return currentValue;
  }

  return coerceNumber(answer, definition.key);
}

async function collectParams(baseValues, overrides, interactive) {
  const nextValues = { ...baseValues };

  Object.entries(overrides).forEach(([key, rawValue]) => {
    const definition = PARAM_DEFINITIONS.find((entry) => entry.key === key);
    if (!definition) {
      throw new Error(`Unknown parameter in --set: ${key}`);
    }
    nextValues[key] = coerceNumber(rawValue, key);
  });

  if (!interactive) {
    return nextValues;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    for (const definition of PARAM_DEFINITIONS) {
      if (overrides.hasOwnProperty(definition.key)) {
        continue;
      }

      const updated = await promptUser(definition, nextValues[definition.key], rl);
      nextValues[definition.key] = updated;
    }
  } finally {
    rl.close();
  }

  return nextValues;
}

function formatSummary(previous, next) {
  const lines = [];
  PARAM_DEFINITIONS.forEach((definition) => {
    const before = previous[definition.key];
    const after = next[definition.key];
    const changed = before !== after;
    const indicator = changed ? '•' : ' ';
    lines.push(`${indicator} ${definition.key}: ${before} → ${after}`);
  });
  return lines.join('\n');
}

function ensureParentDirectory(targetPath, { fsModule = fs } = {}) {
  const directory = path.dirname(targetPath);
  if (!fsModule.existsSync(directory)) {
    fsModule.mkdirSync(directory, { recursive: true });
  }
}

function resolveBackupPath(filePath, backupOption, { now = new Date() } = {}) {
  if (!backupOption) {
    return null;
  }

  if (typeof backupOption === 'string') {
    return path.resolve(backupOption);
  }

  if (backupOption === true) {
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const parsed = path.parse(path.resolve(filePath));
    const backupName = `${parsed.base}.${timestamp}.bak`;
    return path.join(parsed.dir, backupName);
  }

  return null;
}

function persistParams({
  filePath,
  nextValues,
  backupOption,
  fsModule = fs,
  now = new Date(),
}) {
  const serialized = `${JSON.stringify(nextValues, null, 2)}\n`;
  const backupPath = resolveBackupPath(filePath, backupOption, { now });
  if (backupPath) {
    const resolvedTarget = path.resolve(filePath);
    const resolvedBackup = path.resolve(backupPath);
    if (resolvedTarget === resolvedBackup) {
      throw new Error('Backup path must differ from target file');
    }
    ensureParentDirectory(backupPath, { fsModule });
    fsModule.copyFileSync(filePath, backupPath);
  }
  fsModule.writeFileSync(filePath, serialized, 'utf8');
  return { backupPath };
}

async function confirm(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise((resolve) => {
      rl.question(`${message} (y/N) `, (response) => {
        resolve(response.trim().toLowerCase());
      });
    });

    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    return;
  }

  const currentValues = loadParams(args.file);

  const hasOverrides = Object.keys(args.set).length > 0;
  const interactiveCandidate =
    args.interactive !== null
      ? args.interactive
      : !hasOverrides && process.stdin.isTTY && process.stdout.isTTY;
  const interactive = Boolean(interactiveCandidate);
  const nextValues = await collectParams(currentValues, args.set, interactive);

  const validationErrors = validateParams(nextValues);
  if (validationErrors.length > 0) {
    validationErrors.forEach((error) => console.error(`✖ ${error}`));
    throw new Error('Aborting due to validation errors.');
  }

  const summary = formatSummary(currentValues, nextValues);
  console.log('\nProposed parameter set:\n');
  console.log(summary);
  console.log('');

  if (args.dryRun) {
    console.log('Dry run enabled — not writing to disk.');
    console.log(JSON.stringify(nextValues, null, 2));
    return;
  }

  if (!args.yes) {
    const accepted = await confirm('Write changes to file?');
    if (!accepted) {
      console.log('Aborted by user — no changes written.');
      return;
    }
  }

  const { backupPath } = persistParams({
    filePath: args.file,
    nextValues,
    backupOption: args.backup,
  });
  if (backupPath) {
    console.log(`Created backup at ${backupPath}`);
  }
  console.log(`Saved parameters to ${args.file}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  normalizeBackupOption,
  printHelp,
  loadParams,
  coerceNumber,
  validateParams,
  promptUser,
  collectParams,
  formatSummary,
  confirm,
  ensureParentDirectory,
  resolveBackupPath,
  persistParams,
  PARAM_DEFINITIONS,
  DEFAULT_PARAMS_PATH,
  main,
};
