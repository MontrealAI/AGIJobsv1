const fs = require('fs');
const path = require('path');

const THRESHOLD = Number(process.env.COVERAGE_THRESHOLD || 90);
const coverageDir = path.join(__dirname, '..', 'coverage');
const summaryPath = path.join(coverageDir, 'coverage-summary.json');
let totals;

if (fs.existsSync(summaryPath)) {
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  totals = summary.total;
} else {
  const finalPath = path.join(coverageDir, 'coverage-final.json');
  if (!fs.existsSync(finalPath)) {
    console.error('Coverage reports not found in', coverageDir);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(finalPath, 'utf8'));
  const aggregate = {
    lines: { covered: 0, total: 0 },
    branches: { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 },
  };

  Object.values(data).forEach((entry) => {
    const lineHits = entry.l ? Object.values(entry.l) : [];
    aggregate.lines.covered += lineHits.filter((hits) => hits > 0).length;
    aggregate.lines.total += lineHits.length;

    const branchHits = entry.b ? Object.values(entry.b) : [];
    branchHits.forEach((hits) => {
      hits.forEach((hit) => {
        aggregate.branches.total += 1;
        if (hit > 0) {
          aggregate.branches.covered += 1;
        }
      });
    });

    const functionHits = entry.f ? Object.values(entry.f) : [];
    aggregate.functions.covered += functionHits.filter((hits) => hits > 0).length;
    aggregate.functions.total += functionHits.length;
  });

  totals = {
    lines: {
      pct: aggregate.lines.total
        ? (aggregate.lines.covered / aggregate.lines.total) * 100
        : 100,
    },
    branches: {
      pct: aggregate.branches.total
        ? (aggregate.branches.covered / aggregate.branches.total) * 100
        : 100,
    },
    functions: {
      pct: aggregate.functions.total
        ? (aggregate.functions.covered / aggregate.functions.total) * 100
        : 100,
    },
  };
}

const metrics = [
  ['lines', totals.lines?.pct],
  ['branches', totals.branches?.pct],
  ['functions', totals.functions?.pct],
];

const failures = metrics
  .filter(([, value]) => typeof value === 'number' && value < THRESHOLD)
  .map(([name, value]) => `${name} coverage ${value}% is below required ${THRESHOLD}%`);

if (failures.length > 0) {
  failures.forEach((msg) => console.error(msg));
  process.exit(1);
}

console.log('Coverage thresholds met:',
  metrics
    .map(([name, value]) => `${name}=${value?.toFixed?.(2) ?? 'n/a'}%`)
    .join(', ')
);
