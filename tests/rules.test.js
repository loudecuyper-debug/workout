// Unit tests voor de pure regels in poc/index.html (<script id="rules">).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'poc', 'index.html'), 'utf8');
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
