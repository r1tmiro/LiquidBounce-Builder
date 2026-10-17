/** Tiny zero-dependency test harness (ESM). */
export const results = { pass: 0, fail: 0, failures: [] };
let current = '';

export function group(name) {
  current = name;
  console.log(`\n\x1b[36m▸ ${name}\x1b[0m`);
}

export function ok(cond, label, detail = '') {
  if (cond) {
    results.pass++;
    console.log(`  \x1b[32m✔\x1b[0m ${label}`);
  } else {
    results.fail++;
    results.failures.push(`${current}: ${label}${detail ? ' — ' + detail : ''}`);
    console.log(`  \x1b[31m✘ ${label}\x1b[0m${detail ? ' — ' + detail : ''}`);
  }
}

export function eq(a, b, label) {
  ok(a === b, label, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

export function summary() {
  console.log(`\n\x1b[1mResults:\x1b[0m \x1b[32m${results.pass} passed\x1b[0m, ` +
    `${results.fail ? '\x1b[31m' : ''}${results.fail} failed\x1b[0m`);
  if (results.failures.length) {
    console.log('\nFailures:');
    for (const f of results.failures) console.log('  - ' + f);
  }
  return results.fail === 0;
}
