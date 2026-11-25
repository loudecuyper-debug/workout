// Unit tests voor de pure regels in index.html (<script id="rules">).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = /<script id="rules">([\s\S]*?)<\/script>/.exec(html)[1];
const ctx = {};
vm.runInNewContext(code + ';this.Rules=Rules;', ctx);
const R = ctx.Rules;

const ex = (o) => Object.assign({ id: 'x', name: 'X', sets: 3, reps: '10-12', kg: 9.5, rest: 60 }, o);
const sess = (dayIndex, entries) => ({ dayIndex, endedAt: Date.now(), exercises: entries });
const entry = (id, sets) => ({ id, sets: sets.map(([reps, kg]) => ({ reps, kg, done: true })) });

test('parseRange', () => {
  assert.deepStrictEqual({ ...R.parseRange('6-10') }, { min: 6, max: 10 });
  assert.deepStrictEqual({ ...R.parseRange('20') }, { min: 20, max: 20 });
  assert.strictEqual(R.parseRange('max'), null);
  assert.strictEqual(R.parseRange('45-60s'), null);
  assert.strictEqual(R.parseRange('8/been'), null);
});

test('ladder stappen', () => {
  assert.strictEqual(R.nextStep(4.5), 7);
  assert.strictEqual(R.nextStep(17), null);
  assert.strictEqual(R.prevStep(2), null);
  assert.strictEqual(R.prevStep(12), 9.5);
  assert.strictEqual(R.nextStep(11), null, 'gewicht buiten de ladder: geen suggestie');
});

test('rotatie volgt laatste sessie, niet de weekdag', () => {
  assert.strictEqual(R.nextDayIndex([], 5), 0);
  assert.strictEqual(R.nextDayIndex([sess(1, [])], 5), 2);
  assert.strictEqual(R.nextDayIndex([sess(4, [])], 5), 0);
});

test('suggestie: top van range op alle sets', () => {
  const e = ex({});
  assert.strictEqual(R.suggestion([], e, 9.5), null);
  const notYet = [sess(0, [entry('x', [[12, 9.5], [12, 9.5], [11, 9.5]])])];
  assert.strictEqual(R.suggestion(notYet, e, 9.5), null);
  const ready = [sess(0, [entry('x', [[12, 9.5], [12, 9.5], [12, 9.5]])])];
  assert.strictEqual(R.suggestion(ready, e, 9.5).to, 12);
  const otherKg = [sess(0, [entry('x', [[12, 7], [12, 7], [12, 7]])])];
  assert.strictEqual(R.suggestion(otherKg, e, 9.5), null, 'sets op ander gewicht tellen niet');
  const tooFew = [sess(0, [entry('x', [[12, 9.5], [12, 9.5]])])];
  assert.strictEqual(R.suggestion(tooFew, e, 9.5), null, 'niet alle geplande sets gedaan');
});

test('suggestie: elleboog-oefening vraagt twee sessies op rij', () => {
  const e = ex({ elbow: true });
  const top = entry('x', [[12, 9.5], [12, 9.5], [12, 9.5]]);
  assert.strictEqual(R.suggestion([sess(0, [top])], e, 9.5), null);
  assert.strictEqual(R.suggestion([sess(0, [top]), sess(1, [top])], e, 9.5).to, 12);
  const miss = entry('x', [[12, 9.5], [10, 9.5], [12, 9.5]]);
  assert.strictEqual(R.suggestion([sess(0, [miss]), sess(1, [top])], e, 9.5), null);
});

test('geen suggestie voor lichaamsgewicht en max-reps', () => {
  assert.strictEqual(R.suggestion([], ex({ kg: 0 }), 0), null);
  assert.strictEqual(R.suggestion([], ex({ reps: 'max' }), 9.5), null);
});

test('rust: superset-eerste oefening krijgt geen rust', () => {
  const day = { exercises: [ex({ id: 'a', ss: 'b', rest: 60 }), ex({ id: 'b', rest: 90 })] };
  assert.strictEqual(R.restAfter(day, 0), 0);
  assert.strictEqual(R.restAfter(day, 1), 90);
});

test('timer rekent op kloktijd', () => {
  assert.strictEqual(R.remaining(10000, 1000), 9);
  assert.strictEqual(R.remaining(10000, 12000), -2);
});

test('compleet pas als alle sets van alle oefeningen af zijn', () => {
  const day = { exercises: [ex({ id: 'a', sets: 2 }), ex({ id: 'b', sets: 1 })] };
  const half = { exercises: [{ id: 'a', sets: [{ done: true }, { done: true }] }] };
  assert.strictEqual(R.isComplete(half, day), false);
  const lastOnly = { exercises: [{ id: 'a', sets: [{ done: false }, { done: true }] }, { id: 'b', sets: [{ done: true }] }] };
  assert.strictEqual(R.isComplete(lastOnly, day), false, 'laatste set afvinken is niet genoeg');
  const full = { exercises: [{ id: 'a', sets: [{ done: true }, { done: true }] }, { id: 'b', sets: [{ done: true }] }] };
  assert.strictEqual(R.isComplete(full, day), true);
});

test('opwarmset: alleen eerste oefening met gewicht, een stap lager', () => {
  const day = { exercises: [ex({ id: 'p', kg: 0, reps: 'max' }), ex({ id: 'a', kg: 12, reps: '6-10' }), ex({ id: 'b' })] };
  assert.strictEqual(R.warmup(day, 0), null);
  assert.deepStrictEqual({ ...R.warmup(day, 1) }, { kg: 9.5, reps: 10 });
  assert.strictEqual(R.warmup(day, 2), null);
});

test('week begint op maandag', () => {
  const sun = new Date(2026, 10, 29, 20).getTime();
  const mon = new Date(2026, 10, 23, 8).getTime();
  assert.strictEqual(R.weekStart(sun), R.weekStart(mon));
});

const D = 86400000;
const at = (t, dayIndex, entries) => ({ dayIndex, startedAt: t - 3600000, endedAt: t, exercises: entries || [] });
const MON = new Date(2026, 0, 5, 18).getTime(); // maandag

test('blok: week 1 bij start, week 6 is licht, daarna blok 2', () => {
  assert.deepStrictEqual({ ...R.blockInfo([], MON) }, { block: 1, week: 1, light: false });
  const s = [at(MON, 0)];
  assert.strictEqual(R.blockInfo(s, MON + 5 * 7 * D).week, 6);
  assert.strictEqual(R.blockInfo(s, MON + 5 * 7 * D).light, true);
  assert.deepStrictEqual({ ...R.blockInfo(s, MON + 6 * 7 * D) }, { block: 2, week: 1, light: false });
});

test('lichte week: geen gewichtssuggestie', () => {
  const e = ex({});
  const ready = [sess(0, [entry('x', [[12, 9.5], [12, 9.5], [12, 9.5]])])];
  assert.strictEqual(R.suggestion(ready, e, 9.5, true), null);
});

test('reeks: 3 per week telt, vrije week vangt een gemiste week op', () => {
  const wk = (w, n) => Array.from({ length: n }, (_, i) => at(MON + w * 7 * D + i * D, i % 5));
  // week 0: 3, week 1: 3, week 2: 0 (vrije week), week 3 (nu): 3
  const s = [...wk(0, 3), ...wk(1, 3), ...wk(3, 3)];
  const st = R.streakInfo(s, MON + 3 * 7 * D + 3 * D);
  assert.strictEqual(st.streak, 3);
  assert.strictEqual(st.usedFree, 1);
  assert.strictEqual(st.free, 0);
  // twee gemiste weken op rij: reeks breekt
  const s2 = [...wk(0, 3), ...wk(3, 3)];
  assert.strictEqual(R.streakInfo(s2, MON + 3 * 7 * D + 3 * D).streak, 1);
  // volle week geeft een extra vrije week
  const s3 = [...wk(0, 5)];
  assert.strictEqual(R.streakInfo(s3, MON + 7 * D).free, 2);
  // lopende week onder 3 breekt de reeks niet
  assert.strictEqual(R.streakInfo([...wk(0, 3), at(MON + 7 * D, 0)], MON + 7 * D + D).streak, 1);
});

test('sets per spiergroep tellen alleen deze week', () => {
  const info = (id) => ({ a: { muscle: 'Borst' }, b: { muscle: 'Rug' } })[id];
  const s = [at(MON - 7 * D, 0, [entry('a', [[10, 9.5]])]), at(MON, 0, [entry('a', [[10, 9.5], [10, 9.5]]), entry('b', [[8, 12]])])];
  const m = R.muscleSets(s, MON + D, info);
  assert.strictEqual(m.Borst, 2);
  assert.strictEqual(m.Rug, 1);
});

test('vergelijking met vorige keer en records', () => {
  const before = [at(MON, 0, [entry('a', [[10, 9.5], [10, 9.5]]), entry('b', [[8, 12]])])];
  const now = at(MON + 2 * D, 0, [entry('a', [[11, 9.5], [10, 9.5]]), entry('b', [[8, 14.5]])]);
  const c = R.compareToPrevious(before, now);
  assert.strictEqual(c[0].better, true);
  assert.strictEqual(c[1].better, true);
  const prs = R.prsFor(before, now);
  assert.strictEqual(prs.length, 1);
  assert.strictEqual(prs[0].id, 'b');
  assert.strictEqual(R.prsFor([], now).length, 0, 'eerste keer is geen record');
});

test('6 weken geleden: alleen als er toen iets was en het nu beter is', () => {
  const old = at(MON, 0, [entry('a', [[8, 9.5]])]);
  const now = at(MON + 43 * D, 0, [entry('a', [[8, 12]])]);
  assert.strictEqual(R.sixWeeksAgo([old], now).kgThen, 9.5);
  assert.strictEqual(R.sixWeeksAgo([], now), null);
  assert.strictEqual(R.sixWeeksAgo([at(MON + 30 * D, 0, [entry('a', [[8, 9.5]])])], now), null, 'te recent');
});

test('reps tot de volgende stap', () => {
  const e = ex({});
  const s = [sess(0, [entry('x', [[12, 9.5], [10, 9.5], [9, 9.5]])])];
  assert.deepStrictEqual({ ...R.repsToNext(s, e, 9.5) }, { have: 31, need: 36, to: 12 });
  assert.strictEqual(R.repsToNext(s, ex({ reps: 'max' }), 9.5), null);
});

test('vergelijking: onvolledige workout telt alleen dezelfde sets', () => {
  const before = [at(MON, 0, [entry('a', [[10, 9.5], [10, 9.5], [9, 9.5]])])];
  const now = at(MON + 2 * D, 0, [entry('a', [[11, 9.5]])]);
  const c = R.compareToPrevious(before, now)[0];
  assert.strictEqual(c.repsFrom, 10);
  assert.strictEqual(c.repsTo, 11);
  assert.strictEqual(c.better, true);
});

test('vermoeidheid: alleen bij twee keer op rij achteruit op hetzelfde gewicht', () => {
  const e = ex({ id: 'x', reps: '6-10' });
  const s = (reps, kg) => sess(0, [entry('x', [[reps, kg], [reps, kg]])]);
  assert.strictEqual(R.fatigue([s(9, 12), s(8, 12), s(7, 12)], e, 12).to, 9.5);
  assert.strictEqual(R.fatigue([s(9, 12), s(7, 12), s(8, 12)], e, 12), null, 'herstel = geen signaal');
  assert.strictEqual(R.fatigue([s(9, 9.5), s(8, 12), s(7, 12)], e, 12), null, 'te weinig sessies op dit gewicht');
  assert.strictEqual(R.fatigue([s(9, 12), s(8, 12), s(7, 12)], e, 12, true), null, 'niet in de lichte week');
});
