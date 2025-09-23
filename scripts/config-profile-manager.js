'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { hash: namehash } = require('eth-ens-namehash');

const { _internal: configValidators } = require('./validate-config.js');

const SUPPORTED_VARIANTS = ['dev', 'sepolia', 'mainnet'];
const SUPPORTED_SECTIONS = ['agialpha', 'ens', 'registrar'];

const DEFAULT_VARIANT = 'dev';

function cloneDeep(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
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

function persistJson({ filePath, data, backupOption, fsModule = fs, now = new Date() }) {
  const serialized = `${JSON.stringify(data, null, 2)}\n`;
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

function isSupportedVariant(value) {
  return SUPPORTED_VARIANTS.includes(value);
}

function normalizeSectionList(raw) {
  if (!raw || raw.length === 0) {
    return [...SUPPORTED_SECTIONS];
  }
  const normalized = Array.from(new Set(raw.map((entry) => entry.toLowerCase())));
  normalized.forEach((section) => {
    if (!SUPPORTED_SECTIONS.includes(section)) {
      throw new Error(
        `Unsupported section "${section}". Expected one of: ${SUPPORTED_SECTIONS.join(', ')}`
      );
    }
  });
  return normalized;
}

function parseArgs(argv) {
  const args = {
    help: false,
    variant: DEFAULT_VARIANT,
    sections: [],
    sets: [],
    setJson: [],
    yes: false,
    interactive: null,
    dryRun: false,
    backup: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];

    if (current === '--help' || current === '-h') {
      args.help = true;
      continue;
    }

    if (current === '--variant') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('--variant requires a value');
      }
      if (!isSupportedVariant(next)) {
        throw new Error(
          `Unsupported variant "${next}". Expected one of: ${SUPPORTED_VARIANTS.join(', ')}`
        );
      }
      args.variant = next;
      i += 1;
      continue;
    }

    if (current === '--section') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('--section requires a value');
      }
      args.sections.push(next.toLowerCase());
      i += 1;
      continue;
    }

    if (current === '--yes' || current === '--force') {
      args.yes = true;
      continue;
    }

    if (current === '--dry-run') {
      args.dryRun = true;
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
      args.backup = normalizeBackupOption(current.slice('--backup='.length));
      continue;
    }

    if (current === '--set') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('--set requires section.field=value');
      }
      args.sets.push(next);
      i += 1;
      continue;
    }

    if (current.startsWith('--set=')) {
      args.sets.push(current.slice('--set='.length));
      continue;
    }

    if (current === '--set-json') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('--set-json requires section.field=<json>');
      }
      args.setJson.push(next);
      i += 1;
      continue;
    }

    if (current.startsWith('--set-json=')) {
      args.setJson.push(current.slice('--set-json='.length));
      continue;
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  args.sections = normalizeSectionList(args.sections);
  return args;
}

function printHelp() {
  console.log('AGIJobsv1 — configuration profile manager');
  console.log('Usage: node scripts/config-profile-manager.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --variant <dev|sepolia|mainnet>   Target configuration variant (default: dev)');
  console.log('  --section <name>                  Limit to a specific section (repeatable)');
  console.log('  --set section.field=value         Apply non-interactive override');
  console.log('  --set-json section.field=<json>   Apply structured override via JSON');
  console.log('  --dry-run                         Show results without writing to disk');
  console.log('  --yes                             Skip confirmation prompt');
  console.log('  --interactive                     Force interactive prompts even with overrides');
  console.log('  --no-interactive                  Disable prompts (use with --set/--set-json)');
  console.log('  --backup[=<path>]                 Save a backup before writing');
  console.log('  --no-backup                       Skip creating a backup');
  console.log('  --help                            Display this message');
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function loadVariantConfig(variant) {
  const baseDir = path.join(__dirname, '..', 'config');
  const agialphaPath = path.join(baseDir, `agialpha.${variant}.json`);
  const ensPath = path.join(baseDir, `ens.${variant}.json`);
  const registrarPath = path.join(baseDir, `registrar.${variant}.json`);

  return {
    agialpha: { path: agialphaPath, value: readJson(agialphaPath) },
    ens: { path: ensPath, value: readJson(ensPath) },
    registrar: { path: registrarPath, value: readJson(registrarPath) },
  };
}

function isAddress(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function normalizeNullishInput(raw) {
  if (raw === null || raw === undefined) {
    return raw;
  }
  if (typeof raw !== 'string') {
    return raw;
  }
  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === 'null') {
    return null;
  }
  if (trimmed.toLowerCase() === 'undefined') {
    return undefined;
  }
  return raw;
}

function parseBoolean(raw, field) {
  if (typeof raw === 'boolean') {
    return raw;
  }
  if (raw === null || raw === undefined || raw === '') {
    throw new Error(`Value for ${field} must be true or false`);
  }
  const normalized = String(raw).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean value for ${field}: ${raw}`);
}

function parseInteger(raw, field) {
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    return raw;
  }
  const numeric = Number(String(raw).replace(/[_\s]+/g, ''));
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
    throw new Error(`Invalid integer value for ${field}: ${raw}`);
  }
  return numeric;
}

function ensureEnsRootConsistency(config, field, value) {
  const hashField = `${field}Hash`;
  if (value === null || value === undefined || value === '') {
    config[field] = null;
    config[hashField] = null;
    return;
  }
  const trimmed = String(value).trim();
  if (trimmed.length === 0) {
    throw new Error(`${field} must not be empty`);
  }
  const computed = namehash(trimmed);
  config[field] = trimmed;
  config[hashField] = computed;
}

function setAgialphaField(config, field, rawValue, { variant }) {
  const value = normalizeNullishInput(rawValue);
  switch (field) {
    case 'token': {
      if (value === null) {
        config.token = null;
        return;
      }
      if (variant === 'dev' && typeof value === 'string' && value.toLowerCase() === 'mock') {
        config.token = 'mock';
        return;
      }
      if (typeof value !== 'string' || !isAddress(value)) {
        throw new Error('Token must be a 0x-prefixed address or "mock" in development');
      }
      config.token = value;
      return;
    }
    case 'symbol':
    case 'name': {
      if (value === null || value === undefined || String(value).trim().length === 0) {
        throw new Error(`${field} must be provided`);
      }
      config[field] = String(value).trim();
      return;
    }
    case 'decimals': {
      const numeric = parseInteger(value, field);
      if (numeric < 0 || numeric > 255) {
        throw new Error('decimals must be between 0 and 255');
      }
      config.decimals = numeric;
      return;
    }
    case 'burnAddress': {
      if (value === null) {
        throw new Error('burnAddress cannot be null');
      }
      if (typeof value !== 'string' || !isAddress(value)) {
        throw new Error('burnAddress must be a 0x-prefixed address');
      }
      config.burnAddress = value;
      return;
    }
    default:
      throw new Error(`Unsupported agialpha field ${field}`);
  }
}

function setEnsField(config, field, rawValue) {
  const value = normalizeNullishInput(rawValue);
  switch (field) {
    case 'registry':
    case 'nameWrapper': {
      if (value === null || value === undefined || value === '') {
        config[field] = null;
        return;
      }
      if (typeof value !== 'string' || !isAddress(value)) {
        throw new Error(`${field} must be a 0x-prefixed address`);
      }
      config[field] = value;
      return;
    }
    case 'agentRoot':
    case 'clubRoot':
    case 'alphaClubRoot': {
      if (value === null) {
        config[field] = null;
        config[`${field}Hash`] = null;
        return;
      }
      ensureEnsRootConsistency(config, field, value);
      return;
    }
    case 'agentRootHash':
    case 'clubRootHash':
    case 'alphaClubRootHash': {
      if (value === null || value === undefined || value === '') {
        config[field] = null;
        return;
      }
      const normalized = String(value);
      if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
        throw new Error(`${field} must be a 32-byte hex string`);
      }
      config[field] = normalized;
      return;
    }
    case 'alphaEnabled': {
      config.alphaEnabled = parseBoolean(value, 'alphaEnabled');
      return;
    }
    default:
      throw new Error(`Unsupported ENS field ${field}`);
  }
}

function setRegistrarField(config, field, rawValue, { variant }) {
  const value = normalizeNullishInput(rawValue);
  switch (field) {
    case 'address': {
      if (value === null || value === undefined || value === '') {
        config.address = null;
        return;
      }
      if (typeof value !== 'string' || !isAddress(value)) {
        throw new Error('Registrar address must be a 0x-prefixed address');
      }
      config.address = value;
      return;
    }
    case 'defaultToken': {
      if (value === null || value === undefined || value === '') {
        config.defaultToken = null;
        return;
      }
      if (variant === 'dev' && typeof value === 'string' && value.toLowerCase() === 'mock') {
        config.defaultToken = 'mock';
        return;
      }
      if (typeof value !== 'string' || !isAddress(value)) {
        throw new Error('defaultToken must be a 0x-prefixed address');
      }
      config.defaultToken = value;
      return;
    }
    case 'domains': {
      if (!Array.isArray(value)) {
        throw new Error('domains must be an array');
      }
      config.domains = value.map((entry) => cloneDeep(entry));
      return;
    }
    default:
      throw new Error(`Unsupported registrar field ${field}`);
  }
}

function applyDirective(target, directive, { variant }) {
  const [sectionField, rawValue] = (() => {
    const separatorIndex = directive.indexOf('=');
    if (separatorIndex === -1) {
      throw new Error(`Invalid assignment "${directive}". Expected section.field=value`);
    }
    return [directive.slice(0, separatorIndex), directive.slice(separatorIndex + 1)];
  })();

  const [section, field] = (() => {
    const dotIndex = sectionField.indexOf('.');
    if (dotIndex === -1) {
      throw new Error(`Invalid target "${sectionField}". Expected section.field`);
    }
    const section = sectionField.slice(0, dotIndex).toLowerCase();
    const field = sectionField.slice(dotIndex + 1);
    if (!SUPPORTED_SECTIONS.includes(section)) {
      throw new Error(`Unsupported section "${section}"`);
    }
    return [section, field];
  })();

  const targetConfig = target[section].value;
  if (section === 'agialpha') {
    setAgialphaField(targetConfig, field, rawValue, { variant });
  } else if (section === 'ens') {
    setEnsField(targetConfig, field, rawValue);
  } else if (section === 'registrar') {
    setRegistrarField(targetConfig, field, rawValue, { variant });
  }
}

function applyJsonDirective(target, directive, { variant }) {
  const separatorIndex = directive.indexOf('=');
  if (separatorIndex === -1) {
    throw new Error(`Invalid assignment "${directive}". Expected section.field=<json>`);
  }
  const sectionField = directive.slice(0, separatorIndex);
  const jsonValue = directive.slice(separatorIndex + 1);

  let parsed;
  try {
    parsed = JSON.parse(jsonValue);
  } catch (error) {
    throw new Error(`Failed to parse JSON for ${sectionField}: ${error.message}`);
  }

  const [section, field] = (() => {
    const dotIndex = sectionField.indexOf('.');
    if (dotIndex === -1) {
      throw new Error(`Invalid target "${sectionField}". Expected section.field`);
    }
    const section = sectionField.slice(0, dotIndex).toLowerCase();
    const field = sectionField.slice(dotIndex + 1);
    if (!SUPPORTED_SECTIONS.includes(section)) {
      throw new Error(`Unsupported section "${section}"`);
    }
    return [section, field];
  })();

  if (section === 'agialpha') {
    setAgialphaField(target[section].value, field, parsed, { variant });
  } else if (section === 'ens') {
    setEnsField(target[section].value, field, parsed);
  } else if (section === 'registrar') {
    setRegistrarField(target[section].value, field, parsed, { variant });
  }
}

function formatDiff(previous, next) {
  const lines = [];
  const keys = Array.from(
    new Set([...Object.keys(previous || {}), ...Object.keys(next || {})])
  ).sort();
  for (const key of keys) {
    const before = JSON.stringify(previous ? previous[key] : undefined);
    const after = JSON.stringify(next ? next[key] : undefined);
    const changed = before !== after;
    const indicator = changed ? '•' : ' ';
    lines.push(`${indicator} ${key}: ${before} → ${after}`);
  }
  return lines.join('\n');
}

function diffRegistrarDomains(previous, next) {
  const before = JSON.stringify(previous ?? null, null, 2);
  const after = JSON.stringify(next ?? null, null, 2);
  if (before === after) {
    return '  domains unchanged';
  }
  const formatted = ['  domains updated:'];
  formatted.push('    before:');
  formatted.push(...before.split('\n').map((line) => `      ${line}`));
  formatted.push('    after:');
  formatted.push(...after.split('\n').map((line) => `      ${line}`));
  return formatted.join('\n');
}

async function prompt(question, { rl }) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

function formatDefaultValue(value) {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (value === '') {
    return '""';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

async function promptString({ label, current, allowEmpty = false, rl }) {
  const defaultValue = formatDefaultValue(current);
  const answer = await prompt(`${label} [${defaultValue}]: `, { rl });
  if (answer.trim().length === 0) {
    return current;
  }
  if (!allowEmpty && answer.trim().length === 0) {
    console.log('  Value cannot be empty.');
    return promptString({ label, current, allowEmpty, rl });
  }
  const normalized = normalizeNullishInput(answer);
  if (normalized === undefined) {
    return current;
  }
  return normalized === null ? null : String(normalized).trim();
}

async function promptAddress({ label, current, allowNull = true, allowMock = false, rl }) {
  while (true) {
    const answer = await promptString({ label, current, allowEmpty: true, rl });
    if (answer === current) {
      return current;
    }
    if (answer === null) {
      if (!allowNull) {
        console.log('  Value cannot be null.');
        continue;
      }
      return null;
    }
    if (allowMock && typeof answer === 'string' && answer.toLowerCase() === 'mock') {
      return 'mock';
    }
    if (typeof answer === 'string' && isAddress(answer)) {
      return answer;
    }
    console.log('  Please enter a valid 0x-prefixed address.');
  }
}

async function promptInteger({ label, current, minimum = null, maximum = null, rl }) {
  while (true) {
    const answer = await promptString({ label, current, allowEmpty: true, rl });
    if (answer === current) {
      return current;
    }
    try {
      const numeric = parseInteger(answer, label);
      if (minimum !== null && numeric < minimum) {
        console.log(`  Value must be at least ${minimum}.`);
        continue;
      }
      if (maximum !== null && numeric > maximum) {
        console.log(`  Value must be at most ${maximum}.`);
        continue;
      }
      return numeric;
    } catch (error) {
      console.log(`  ${error.message}`);
    }
  }
}

async function promptBoolean({ label, current, rl }) {
  while (true) {
    const defaultValue =
      current === null || current === undefined ? 'false' : current ? 'true' : 'false';
    const answer = await prompt(`${label} [${defaultValue}]: `, { rl });
    if (answer.trim().length === 0) {
      return !!current;
    }
    try {
      return parseBoolean(answer, label);
    } catch (error) {
      console.log(`  ${error.message}`);
    }
  }
}

async function promptEnsRoot({ label, field, config, rl }) {
  while (true) {
    const current = config[field];
    const answer = await promptString({ label, current, allowEmpty: true, rl });
    if (answer === current) {
      return;
    }
    if (answer === null) {
      config[field] = null;
      config[`${field}Hash`] = null;
      return;
    }
    if (typeof answer === 'string' && answer.trim().length > 0) {
      ensureEnsRootConsistency(config, field, answer);
      return;
    }
    console.log('  Value cannot be empty.');
  }
}

async function promptRegistrarLabel(existing, { rl }) {
  const label = await promptString({
    label: '    Label',
    current: existing.label || '',
    allowEmpty: false,
    rl,
  });
  let minPrice = existing.minPrice || null;
  let maxPrice = existing.maxPrice || null;
  const rawMin = await promptString({
    label: '    Min price (wei or null)',
    current: minPrice,
    allowEmpty: true,
    rl,
  });
  if (rawMin === null) {
    minPrice = null;
  } else if (typeof rawMin === 'string' && rawMin.trim().length > 0) {
    minPrice = rawMin.trim();
  }
  const rawMax = await promptString({
    label: '    Max price (wei or null)',
    current: maxPrice,
    allowEmpty: true,
    rl,
  });
  if (rawMax === null) {
    maxPrice = null;
  } else if (typeof rawMax === 'string' && rawMax.trim().length > 0) {
    maxPrice = rawMax.trim();
  }

  const next = { label: typeof label === 'string' ? label.trim() : label };
  if (minPrice && minPrice.length > 0) {
    next.minPrice = minPrice;
  }
  if (maxPrice && maxPrice.length > 0) {
    next.maxPrice = maxPrice;
  }
  return next;
}

async function editRegistrarLabels(existing = [], { rl }) {
  const result = [];
  for (let index = 0; index < existing.length; index += 1) {
    const entry = existing[index];
    const action = await prompt(
      `  Label #${index + 1} (${entry.label || 'unnamed'}) — [k]eep, [e]dit, [d]elete? `,
      { rl }
    );
    const normalized = action.trim().toLowerCase();
    if (normalized === '' || normalized === 'k') {
      result.push(cloneDeep(entry));
      continue;
    }
    if (normalized === 'd' || normalized === 'delete') {
      continue;
    }
    if (normalized === 'e' || normalized === 'edit') {
      const updated = await promptRegistrarLabel(entry, { rl });
      result.push(updated);
      continue;
    }
    console.log('  Unrecognized option. Keeping existing entry.');
    result.push(cloneDeep(entry));
  }

  while (true) {
    const addMore = await prompt('  Add another label? (y/N) ', { rl });
    const normalized = addMore.trim().toLowerCase();
    if (normalized === 'y' || normalized === 'yes') {
      const created = await promptRegistrarLabel({}, { rl });
      result.push(created);
    } else if (normalized === 'n' || normalized === 'no' || normalized === '') {
      break;
    } else {
      console.log('  Please answer y or n.');
    }
  }
  return result;
}

async function promptRegistrarDomain(existing, { rl }) {
  let name = existing.name || '';
  while (true) {
    const answer = await promptString({
      label: '  Domain name',
      current: name,
      allowEmpty: false,
      rl,
    });
    if (typeof answer === 'string' && answer.trim().length > 0) {
      name = answer.trim();
      break;
    }
    console.log('  Domain name cannot be empty.');
  }
  const rootKey = await promptString({
    label: '  Root key',
    current: existing.rootKey || '',
    allowEmpty: false,
    rl,
  });
  const labels = await editRegistrarLabels(existing.labels || [], { rl });
  const domain = { name, rootKey: typeof rootKey === 'string' ? rootKey.trim() : rootKey };
  if (labels.length > 0) {
    domain.labels = labels;
  }
  return domain;
}

async function editRegistrarDomains(existing = [], { rl }) {
  const result = [];
  for (let index = 0; index < existing.length; index += 1) {
    const entry = existing[index];
    const action = await prompt(
      `Domain #${index + 1} (${entry.name || 'unnamed'}) — [k]eep, [e]dit, [d]elete? `,
      { rl }
    );
    const normalized = action.trim().toLowerCase();
    if (normalized === '' || normalized === 'k') {
      result.push(cloneDeep(entry));
      continue;
    }
    if (normalized === 'd' || normalized === 'delete') {
      continue;
    }
    if (normalized === 'e' || normalized === 'edit') {
      const updated = await promptRegistrarDomain(entry, { rl });
      result.push(updated);
      continue;
    }
    console.log('  Unrecognized option. Keeping existing entry.');
    result.push(cloneDeep(entry));
  }

  while (true) {
    const addMore = await prompt('Add another domain? (y/N) ', { rl });
    const normalized = addMore.trim().toLowerCase();
    if (normalized === 'y' || normalized === 'yes') {
      const created = await promptRegistrarDomain({}, { rl });
      result.push(created);
    } else if (normalized === 'n' || normalized === 'no' || normalized === '') {
      break;
    } else {
      console.log('  Please answer y or n.');
    }
  }
  return result;
}

async function editAgialphaInteractive(config, { variant, rl }) {
  console.log('\nToken configuration');
  config.token = await promptAddress({
    label: 'Token address (or "mock" for dev)',
    current: config.token ?? '',
    allowNull: false,
    allowMock: variant === 'dev',
    rl,
  });
  config.symbol = await promptString({ label: 'Token symbol', current: config.symbol || '', rl });
  config.name = await promptString({ label: 'Token name', current: config.name || '', rl });
  config.decimals = await promptInteger({
    label: 'Token decimals',
    current: config.decimals ?? 18,
    minimum: 0,
    maximum: 255,
    rl,
  });
  config.burnAddress = await promptAddress({
    label: 'Burn address',
    current: config.burnAddress ?? '',
    allowNull: false,
    rl,
  });
}

async function editEnsInteractive(config, { rl }) {
  console.log('\nENS configuration');
  config.registry = await promptAddress({
    label: 'ENS registry address',
    current: config.registry ?? '',
    allowNull: false,
    rl,
  });
  config.nameWrapper = await promptAddress({
    label: 'ENS name wrapper address (optional)',
    current: config.nameWrapper ?? '',
    allowNull: true,
    rl,
  });
  await promptEnsRoot({
    label: 'Agent root (e.g., agent.agi.eth)',
    field: 'agentRoot',
    config,
    rl,
  });
  await promptEnsRoot({ label: 'Club root (e.g., club.agi.eth)', field: 'clubRoot', config, rl });
  await promptEnsRoot({ label: 'Alpha club root (optional)', field: 'alphaClubRoot', config, rl });
  config.alphaEnabled = await promptBoolean({
    label: 'Alpha enabled',
    current: config.alphaEnabled ?? false,
    rl,
  });
}

async function editRegistrarInteractive(config, { variant, rl }) {
  console.log('\nRegistrar configuration');
  config.address = await promptAddress({
    label: 'Registrar contract address (optional)',
    current: config.address ?? '',
    allowNull: true,
    rl,
  });
  config.defaultToken = await promptAddress({
    label: 'Default token address (optional)',
    current: config.defaultToken ?? '',
    allowNull: true,
    allowMock: variant === 'dev',
    rl,
  });
  config.domains = await editRegistrarDomains(config.domains || [], { rl });
}

function validateVariantConfig({ variant, agialpha, ens, registrar }) {
  const errors = [];
  const agiFile = `config/agialpha.${variant}.json`;
  const ensFile = `config/ens.${variant}.json`;
  const registrarFile = `config/registrar.${variant}.json`;
  configValidators.validateAgiAlphaConfig(errors, agiFile, agialpha, { variant });
  configValidators.validateEnsConfig(errors, ensFile, ens, { variant });
  configValidators.validateRegistrarConfig(errors, registrarFile, registrar, {
    variant,
    agiConfig: agialpha,
  });
  if (errors.length > 0) {
    const message = ['Validation failed:'].concat(errors.map((entry) => ` - ${entry}`)).join('\n');
    throw new Error(message);
  }
}

async function runInteractiveFlow(state, { variant, sections }) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (sections.includes('agialpha')) {
      await editAgialphaInteractive(state.agialpha.value, { variant, rl });
    }
    if (sections.includes('ens')) {
      await editEnsInteractive(state.ens.value, { rl });
    }
    if (sections.includes('registrar')) {
      await editRegistrarInteractive(state.registrar.value, { variant, rl });
    }
  } finally {
    rl.close();
  }
}

function summarizeChanges(state, original) {
  const summaries = [];
  const agialphaDiff = formatDiff(original.agialpha.value, state.agialpha.value);
  summaries.push('AGIALPHA:\n' + agialphaDiff);
  const ensDiff = formatDiff(original.ens.value, state.ens.value);
  summaries.push('ENS:\n' + ensDiff);
  const registrarSummary = diffRegistrarDomains(
    Array.isArray(original.registrar.value.domains) ? original.registrar.value.domains : [],
    Array.isArray(state.registrar.value.domains) ? state.registrar.value.domains : []
  );
  const registrarHeader = formatDiff(
    {
      address: original.registrar.value.address,
      defaultToken: original.registrar.value.defaultToken,
    },
    { address: state.registrar.value.address, defaultToken: state.registrar.value.defaultToken }
  );
  summaries.push('Registrar:\n' + registrarHeader + '\n' + registrarSummary);
  return summaries.join('\n\n');
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
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  if (args.help) {
    printHelp();
    return;
  }

  const targetSections = normalizeSectionList(args.sections);

  const originalState = loadVariantConfig(args.variant);
  const state = {
    agialpha: { path: originalState.agialpha.path, value: cloneDeep(originalState.agialpha.value) },
    ens: { path: originalState.ens.path, value: cloneDeep(originalState.ens.value) },
    registrar: {
      path: originalState.registrar.path,
      value: cloneDeep(originalState.registrar.value),
    },
  };

  try {
    for (const directive of args.sets) {
      applyDirective(state, directive, { variant: args.variant });
    }
    for (const directive of args.setJson) {
      applyJsonDirective(state, directive, { variant: args.variant });
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const shouldPrompt = args.interactive !== false && targetSections.length > 0;
  if (shouldPrompt) {
    await runInteractiveFlow(state, { variant: args.variant, sections: targetSections });
  }

  try {
    validateVariantConfig({
      variant: args.variant,
      agialpha: state.agialpha.value,
      ens: state.ens.value,
      registrar: state.registrar.value,
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const sectionsChanged = SUPPORTED_SECTIONS.filter(
    (section) =>
      targetSections.includes(section) &&
      JSON.stringify(originalState[section].value) !== JSON.stringify(state[section].value)
  );

  const summary = summarizeChanges(state, originalState);
  console.log('\nPlanned changes for variant %s:', args.variant);
  console.log(summary);

  if (sectionsChanged.length === 0) {
    console.log('\nNo changes detected.');
    return;
  }

  if (args.dryRun) {
    console.log('\nDry run mode enabled; not writing changes.');
    return;
  }

  if (!args.yes) {
    const confirmed = await confirm('Write updated configuration files?');
    if (!confirmed) {
      console.log('Aborted.');
      return;
    }
  }

  const backups = [];
  try {
    if (sectionsChanged.includes('agialpha')) {
      const { backupPath } = persistJson({
        filePath: state.agialpha.path,
        data: state.agialpha.value,
        backupOption: args.backup,
      });
      if (backupPath) {
        backups.push({ file: state.agialpha.path, backupPath });
      }
    }
    if (sectionsChanged.includes('ens')) {
      const { backupPath } = persistJson({
        filePath: state.ens.path,
        data: state.ens.value,
        backupOption: args.backup,
      });
      if (backupPath) {
        backups.push({ file: state.ens.path, backupPath });
      }
    }
    if (sectionsChanged.includes('registrar')) {
      const { backupPath } = persistJson({
        filePath: state.registrar.path,
        data: state.registrar.value,
        backupOption: args.backup,
      });
      if (backupPath) {
        backups.push({ file: state.registrar.path, backupPath });
      }
    }
  } catch (error) {
    console.error('Failed to persist configuration:', error.message || error);
    process.exitCode = 1;
    return;
  }

  console.log('\nConfiguration files updated successfully.');
  if (backups.length > 0) {
    backups.forEach(({ file, backupPath }) => {
      console.log(`Backup for ${file} → ${backupPath}`);
    });
  }
  console.log(
    'Run `npm run config:validate` to confirm the repository configuration still passes guardrails.'
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  normalizeBackupOption,
  ensureEnsRootConsistency,
  setAgialphaField,
  setEnsField,
  setRegistrarField,
  applyDirective,
  applyJsonDirective,
  validateVariantConfig,
};
