#!/usr/bin/env node
/**
 * Smoke checks against a running server.
 *
 * Unit tests cover the rules; this covers the deployment. It asks the live API
 * the questions that matter after a release: is it up, do the public endpoints
 * still answer, and — most importantly — does anything leak a correct answer to
 * someone who has not earned the right to see it.
 *
 * That last group is the point of the whole exercise. Synchronised reveal is
 * the feature this project is built around, and it can break silently: a stray
 * `include` in a Prisma query is enough. Nobody would notice until a player
 * opened the network tab mid-match.
 *
 * Usage, from the API directory on the server:
 *
 *   node scripts/smoke.mjs                      # checks https://30sec.org
 *   node scripts/smoke.mjs http://127.0.0.1:3000
 *
 * Exits non-zero if any check fails, so it can gate a deploy.
 */

const BASE = (process.argv[2] || 'https://30sec.org').replace(/\/+$/, '');
const API = BASE.endsWith('/api') ? BASE : `${BASE}/api`;

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, detail = '') {
  passed++;
  console.log(`  ok    ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, reason) {
  failed++;
  failures.push(`${name}: ${reason}`);
  console.log(`  FAIL  ${name} — ${reason}`);
}

async function get(path) {
  const res = await fetch(`${API}${path}`, { headers: { accept: 'application/json' } });
  let body = null;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** Walk a structure looking for any key that smells like a revealed answer. */
function findAnswerLeak(value, path = '$') {
  if (value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findAnswerLeak(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, val] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (lower.includes('correctanswer') && val !== null && val !== '') {
      return `${path}.${key}`;
    }
    const hit = findAnswerLeak(val, `${path}.${key}`);
    if (hit) return hit;
  }
  return null;
}

async function main() {
  console.log(`\nSmoke checks against ${API}\n`);

  console.log('Availability');
  {
    const { status, body } = await get('/health');
    status === 200 && body?.ok === true
      ? ok('health responds', `ts ${body.ts}`)
      : fail('health responds', `status ${status}, body ${JSON.stringify(body).slice(0, 80)}`);
  }

  console.log('\nPublic reference data');
  {
    const { status, body } = await get('/ranks');
    if (status !== 200 || !Array.isArray(body)) {
      fail('ranks listed', `status ${status}`);
    } else if (body.length === 0) {
      fail('ranks listed', 'empty — the seed has not run');
    } else {
      const thresholds = body.map((r) => r.thresholdCorrectAnswers);
      const ascending = thresholds.every((t, i) => i === 0 || t >= thresholds[i - 1]);
      ascending
        ? ok('ranks listed', `${body.length}, thresholds ascending`)
        : fail('ranks listed', `thresholds out of order: ${thresholds.join(', ')}`);
    }
  }
  {
    const { status, body } = await get('/reactions/types');
    status === 200 && Array.isArray(body) && body.length > 0
      ? ok('reaction types listed', `${body.length}`)
      : fail('reaction types listed', `status ${status}`);
  }
  {
    const { status, body } = await get('/leaderboard?limit=5');
    status === 200 && Array.isArray(body)
      ? ok('leaderboard responds', `${body.length} row(s)`)
      : fail('leaderboard responds', `status ${status}`);
  }

  console.log('\nAuthorisation');
  for (const [path, label] of [
    ['/admin/dashboard', 'admin dashboard'],
    ['/questions', 'question library'],
    ['/auth/me', 'own profile'],
  ]) {
    const { status } = await get(path);
    status === 401 || status === 403
      ? ok(`${label} refuses anonymous access`, `status ${status}`)
      : fail(`${label} refuses anonymous access`, `expected 401/403, got ${status}`);
  }

  console.log('\nAnswer disclosure');
  const live = await get('/tournaments/live/active');
  if (live.status !== 200 || !Array.isArray(live.body)) {
    fail('live tournament list', `status ${live.status}`);
  } else if (live.body.length === 0) {
    ok('live tournament list', 'none running — disclosure checks skipped');
  } else {
    for (const t of live.body) {
      const pub = await get(`/tournaments/${t.id}/public-live`);
      if (pub.status !== 200) {
        fail(`public view of ${t.title || t.id}`, `status ${pub.status}`);
        continue;
      }
      const phase = pub.body?.phase;
      const leak = findAnswerLeak(pub.body);
      if (leak && phase !== 'judging') {
        fail(`public view of ${t.title || t.id}`, `correct answer exposed at ${leak} during phase "${phase}"`);
      } else {
        ok(`public view of ${t.title || t.id}`, `phase "${phase}", no answer exposed`);
      }

      const spec = await get(`/spectator/live/${t.id}`);
      if (spec.status === 200) {
        const specLeak = findAnswerLeak(spec.body);
        specLeak
          ? fail(`spectator view of ${t.title || t.id}`, `correct answer exposed at ${specLeak}`)
          : ok(`spectator view of ${t.title || t.id}`, 'no answer exposed');
      }
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    console.log('Failures:');
    for (const f of failures) console.log(`  - ${f}`);
    console.log('');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nSmoke run could not complete: ${err.message}\n`);
  process.exit(2);
});
