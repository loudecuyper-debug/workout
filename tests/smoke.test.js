// jsdom smoke test: klikt een echte workout door via de DOM en controleert localStorage.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const open = [];
test.afterEach(() => { while (open.length) open.pop().close(); });

const html = fs.readFileSync(path.join(__dirname, '..', 'poc', 'index.html'), 'utf8');

function boot(preload) {
  const errors = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/workout/poc/',
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.confirm = () => true;
      w.addEventListener('error', (e) => errors.push(e.message));
      if (preload) w.localStorage.setItem('wo_v1', JSON.stringify(preload));
    }
  });
  const w = dom.window;
  open.push(w);
  const $ = (s) => w.document.querySelector(s);
  const click = (s) => { const el = $(s); assert.ok(el, 'knop ontbreekt: ' + s); el.click(); };
  const state = () => JSON.parse(w.localStorage.getItem('wo_v1'));
  return { w, $, click, state, errors, text: () => w.document.getElementById('app').textContent };
}

test('lege start toont Push A en de vijf dagen', () => {
  const a = boot();
  assert.match(a.text(), /Push A/);
  assert.strictEqual(a.w.document.querySelectorAll('.daypick button').length, 5);
  assert.deepStrictEqual(a.errors, []);
});

test('volledige workout loggen, superset zonder rust, rotatie gaat door', () => {
  const a = boot();
  a.click('[data-act="pick"][data-arg="1"]'); // Pull A, heeft superset
  a.click('[data-act="start"]');
  assert.ok(a.state().active, 'actieve workout bewaard');
  let guard = 0;
  while (a.$('[data-act="setDone"]') && guard++ < 100) {
    const name = a.$('.h1').textContent;
    a.click('[data-act="setDone"]');
    const st = a.state().active;
    if (name === 'Bicep Curl') {
      assert.strictEqual(st.restEndsAt === null || st.restEndsAt < Date.now() + 1000, true, 'geen rust na superset-set');
      assert.strictEqual(a.$('.h1').textContent, 'Hammer Curl', 'superset springt naar partner');
    }
    if (a.$('[data-act="restSkip"]')) a.click('[data-act="restSkip"]');
    if (!a.$('[data-act="setDone"]')) {
      // oefening klaar maar workout niet: naar de volgende met open sets
      a.click('[data-act="ex"][data-arg="1"]');
    }
    const s = a.state().active;
    if (!s) break;
    const total = s.exercises.reduce((n, e) => n + e.sets.filter((x) => x && x.done).length, 0);
    if (total === 19) break;
  }
  const s = a.state();
  const total = s.active.exercises.reduce((n, e) => n + e.sets.filter((x) => x && x.done).length, 0);
  assert.strictEqual(total, 19, 'alle 19 sets van Pull A gelogd');
  a.click('[data-act="finish"]');
  const after = a.state();
  assert.strictEqual(after.active, null);
  assert.strictEqual(after.sessions.length, 1);
  assert.strictEqual(after.sessions[0].dayIndex, 1);
  assert.match(a.text(), /Klaar\. 19 sets/);
  a.click('[data-act="home"]');
  assert.match(a.text(), /Volgende in de rij/);
  assert.match(a.$('.h1').textContent, /Benen/, 'na Pull A komt Benen');
  assert.deepStrictEqual(a.errors, []);
});

test('vorige reps worden voorgesteld en +/- past ze aan', () => {
  const prev = { v: 1, kg: {}, active: null, lastExport: null, sessions: [
    { dayIndex: 2, endedAt: Date.now() - 86400000, startedAt: Date.now() - 90000000,
      exercises: [{ id: 'goblet-squat', name: 'Goblet Squat', sets: [{ reps: 9, kg: 12, done: true }] }] }
  ] };
  const a = boot(prev);
  a.click('[data-act="pick"][data-arg="2"]');
  a.click('[data-act="start"]');
  assert.strictEqual(a.$('.counter .val b').textContent, '9');
  assert.ok(a.$('.counter .val b').classList.contains('ghost'), 'grijs tot je iets aanraakt');
  assert.match(a.text(), /vorig 9/);
  a.click('[data-act="plus"]');
  assert.strictEqual(a.$('.counter .val b').textContent, '10');
  assert.ok(!a.$('.counter .val b').classList.contains('ghost'));
  assert.match(a.text(), /Eerst opwarmen: 1 × 10 op 9,5 kg/);
  a.click('[data-act="setDone"]');
  assert.strictEqual(a.state().active.exercises[0].sets[0].reps, 10);
});

test('workout overleeft herladen van de app', () => {
  const a = boot();
  a.click('[data-act="start"]');
  a.click('[data-act="setDone"]');
  const saved = a.state();
  const b = boot(saved);
  assert.match(b.text(), /Set 2 klaar/, 'gaat verder waar je was');
  assert.ok(b.$('#timer'), 'rusttimer loopt door');
});

test('kapotte opslag crasht de app niet', () => {
  const errors = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://localhost/', beforeParse(w) {
    w.matchMedia = () => ({ matches: false });
    w.localStorage.setItem('wo_v1', '{kapot');
    w.addEventListener('error', (e) => errors.push(e.message));
  } });
  open.push(dom.window);
  assert.match(dom.window.document.getElementById('app').textContent, /Push A/);
  assert.deepStrictEqual(errors, []);
});
