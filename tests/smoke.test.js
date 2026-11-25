// jsdom smoke test: klikt een echte workout door via de DOM en controleert localStorage.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const open = [];
test.afterEach(() => { while (open.length) open.pop().close(); });

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function boot(preload) {
  const errors = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/workout/',
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.confirm = () => true;
      w.scrollTo = () => {};
      w.addEventListener('error', (e) => errors.push(e.message));
      if (preload) w.localStorage.setItem('workout_v2', JSON.stringify(preload));
    }
  });
  const w = dom.window;
  open.push(w);
  const $ = (s) => w.document.querySelector(s);
  const click = (s) => { const el = $(s); assert.ok(el, 'knop ontbreekt: ' + s); el.click(); };
  const state = () => JSON.parse(w.localStorage.getItem('workout_v2'));
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
  assert.match(a.text(), /Klaar\. 19 \/ 19 sets/);
  a.click('[data-act="doneOk"]');
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
    w.localStorage.setItem('workout_v2', '{kapot');
    w.addEventListener('error', (e) => errors.push(e.message));
  } });
  open.push(dom.window);
  assert.match(dom.window.document.getElementById('app').textContent, /Push A/);
  assert.deepStrictEqual(errors, []);
});

test('wisselen: Bicep Curl naar Concentration Curl, historiek per oefening', () => {
  const a = boot();
  a.click('[data-act="pick"][data-arg="1"]');
  a.click('[data-act="start"]');
  for (let i = 0; i < 4; i++) a.click('[data-act="ex"][data-arg="1"]');
  assert.strictEqual(a.$('.h1').textContent, 'Bicep Curl');
  a.click('[data-act="swapOpen"]');
  a.click('[data-act="swapTo"][data-arg="conc-curl"]');
  assert.strictEqual(a.$('.h1').textContent, 'Concentration Curl');
  a.click('[data-act="setDone"]');
  assert.strictEqual(a.$('.h1').textContent, 'Hammer Curl', 'superset blijft werken na wissel');
  const ex = a.state().active.exercises.find((e) => e.id === 'conc-curl');
  assert.ok(ex && ex.sets[0].done);
  assert.deepStrictEqual(a.errors, []);
});

test('lichte week 6: een set minder en het staat erbij', () => {
  const W = 7 * 86400000;
  const s = { v: 2, kg: {}, active: null, lastExport: null, sessions: [
    { dayIndex: 4, startedAt: Date.now() - 5 * W - 3600000, endedAt: Date.now() - 5 * W, exercises: [] }
  ] };
  const a = boot(s);
  assert.match(a.text(), /week 6 van 6/);
  assert.match(a.text(), /Lichte week/);
  a.click('[data-act="start"]');
  assert.strictEqual(a.w.document.querySelectorAll('.sets .set').length, 3, 'Chest Press 4 -> 3 sets');
  assert.match(a.text(), /licht/);
});

test('alle tabs renderen met data, sessie verwijderen werkt', () => {
  const t = Date.now() - 2 * 86400000;
  const mk = (d, kg) => ({ dayIndex: 0, dayName: 'Push A', startedAt: d - 3600000, endedAt: d,
    exercises: [{ id: 'chest-press', name: 'Chest Press (vloer)', sets: [{ reps: 10, kg, done: true }, { reps: 9, kg, done: true }] }] });
  const a = boot({ v: 2, kg: {}, active: null, lastExport: null, sessions: [mk(t - 86400000 * 7, 9.5), mk(t, 12)] });
  a.click('[data-act="tab"][data-arg="progress"]');
  assert.ok(a.$('svg.chart'), 'grafiek zichtbaar');
  assert.match(a.text(), /Gewichtsladder/);
  a.click('[data-act="metric"][data-arg="vol"]');
  a.click('[data-act="tab"][data-arg="history"]');
  a.click('[data-act="toggleSession"][data-arg="1"]');
  a.click('[data-act="deleteSession"][data-arg="1"]');
  assert.strictEqual(a.state().sessions.length, 1);
  a.click('[data-act="tab"][data-arg="settings"]');
  assert.match(a.text(), /Backup maken/);
  a.click('[data-act="tab"][data-arg="today"]');
  assert.match(a.text(), /Focus deze week/);
  assert.deepStrictEqual(a.errors, []);
});

test('klaar-scherm toont wat beter ging en een record', () => {
  const t = Date.now() - 86400000;
  const prev = { v: 2, kg: {}, active: null, lastExport: null, sessions: [
    { dayIndex: 4, startedAt: t - 3600000, endedAt: t, exercises: [] },
    { dayIndex: 0, startedAt: t - 3600000, endedAt: t + 1, exercises: [{ id: 'chest-press', name: 'Chest Press (vloer)', sets: [{ reps: 8, kg: 9.5, done: true }] }] },
    { dayIndex: 4, startedAt: t - 3600000, endedAt: t + 2, exercises: [] }
  ] };
  const a = boot(prev);
  assert.match(a.$('.h1').textContent, /Push A/);
  a.click('[data-act="start"]');
  a.click('[data-act="setDone"]'); // 8 reps op 12 kg
  a.click('[data-act="finish"]');
  assert.match(a.text(), /Wat beter ging/);
  assert.match(a.text(), /Nieuw record/);
  assert.strictEqual(a.state().sessions.at(-1).prs.length, 1);
});

test('backup terugzetten loopt door dezelfde migrate()', () => {
  const a = boot();
  const backup = { app: 'workout', version: '2.0.0', state: { v: 1, kg: { ohp: 14.5 }, sessions: [
    { dayIndex: 0, startedAt: 1, endedAt: 2, exercises: [] }, { kapot: true }] } };
  a.w.eval('importText(' + JSON.stringify(JSON.stringify(backup)) + ')');
  const s = a.state();
  assert.strictEqual(s.sessions.length, 1, 'kapotte sessie eruit gefilterd');
  assert.strictEqual(s.kg.ohp, 14.5);
  assert.strictEqual(s.v, 2);
});

test('oude app- en testdata worden opgeruimd, andere apps niet', () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://localhost/workout/', beforeParse(w) {
    w.matchMedia = () => ({ matches: false });
    w.localStorage.setItem('wo_v1', '{"sessions":[]}');
    w.localStorage.setItem('wt_h4', '[]');
    w.localStorage.setItem('wt_kgs', '{}');
    w.localStorage.setItem('budget_state', 'blijft');
  } });
  open.push(dom.window);
  const ls = dom.window.localStorage;
  assert.strictEqual(ls.getItem('wo_v1'), null);
  assert.strictEqual(ls.getItem('wt_h4'), null);
  assert.strictEqual(ls.getItem('wt_kgs'), null);
  assert.strictEqual(ls.getItem('budget_state'), 'blijft');
});
