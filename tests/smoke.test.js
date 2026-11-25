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
      exercises: [{ id: 'rdl', name: 'Romanian Deadlift', sets: [{ reps: 9, kg: 12, done: true }] }] }
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
  a.click('[data-act="more"]');
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

test('animaties: set-blokje springt, teller beweegt, timer schuift in, cijfers tellen op', () => {
  const a = boot();
  a.click('[data-act="start"]');
  assert.ok(a.$('.in'), 'binnenkomst-animatie bij nieuw scherm');
  a.click('[data-act="plus"]');
  assert.ok(a.$('.counter .val b.bump-up'));
  a.click('[data-act="setDone"]');
  assert.ok(a.$('.sets .set.pop'), 'afgevinkte set springt');
  assert.ok(a.$('#timer.slide'), 'rusttimer schuift in');
  assert.ok(!a.$('.counter .val b.bump-up'), 'flash maar één keer');
  a.click('[data-act="finish"]');
  assert.ok(a.$('.h1.slam'));
  assert.ok(a.$('[data-count]'));
  assert.deepStrictEqual(a.errors, []);
});

test('animaties staan uit bij Beperk beweging', () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/workout/', beforeParse(w) {
    w.matchMedia = (q) => ({ matches: /reduce/.test(q), addListener() {}, removeListener() {} });
    w.scrollTo = () => {};
  } });
  open.push(dom.window);
  dom.window.document.querySelector('[data-act="start"]').click();
  assert.strictEqual(dom.window.document.querySelector('.in'), null);
});

test('kalender in Geschiedenis: workoutdagen gekleurd, tik opent sessie, vorige maand', () => {
  const d = new Date(); const day = (n) => new Date(d.getFullYear(), d.getMonth(), n, 19).getTime();
  const mk = (n, di, id) => ({ dayIndex: di, dayId: id, dayName: id, startedAt: day(n) - 3e6, endedAt: day(n), exercises: [{ id: 'goblet-squat', name: 'Goblet Squat', sets: [{ reps: 8, kg: 12, done: true }] }] });
  const sessions = [mk(1, 0, 'push-a'), mk(Math.min(2, d.getDate()), 2, 'legs')];
  const a = boot({ v: 2, kg: {}, active: null, lastExport: null, sessions });
  a.click('[data-act="tab"][data-arg="history"]');
  const hits = a.w.document.querySelectorAll('.cal .d.hit');
  assert.ok(hits.length >= 1, 'workoutdagen zichtbaar');
  assert.match(a.text(), /Week van/);
  hits[0].click();
  assert.ok(a.$('[aria-expanded="true"]'), 'sessie open na tik op dag');
  assert.ok(a.$('[data-act="calMove"][data-arg="1"][disabled]'), 'niet naar de toekomst');
  a.click('[data-act="calMove"][data-arg="-1"]');
  assert.strictEqual(a.w.document.querySelectorAll('.cal .d.hit').length, 0, 'vorige maand leeg');
  assert.deepStrictEqual(a.errors, []);
});

const W2 = () => ({ v: 2, kg: {}, active: null, lastExport: null, sessions: [] });
const sessAt = (ago, exs) => ({ dayIndex: 0, dayId: 'push-a', dayName: 'Push A', startedAt: Date.now() - ago * 86400000 - 3e6, endedAt: Date.now() - ago * 86400000, exercises: exs });

test('set achteraf aanpassen en verwijderen in Geschiedenis', () => {
  const s = W2(); s.sessions = [sessAt(1, [{ id: 'chest-press', name: 'Chest Press (vloer)', sets: [{ reps: 100, kg: 12, done: true }, { reps: 9, kg: 12, done: true }] }])];
  const a = boot(s);
  a.click('[data-act="tab"][data-arg="history"]');
  a.click('[data-act="toggleSession"][data-arg="0"]');
  a.click('[data-act="editSet"][data-arg="0"][data-arg2="0:0"]');
  assert.strictEqual(a.$('.counter .val b').textContent, '100');
  for (let i = 0; i < 90; i++) a.click('[data-act="editReps"][data-arg="-1"]');
  a.click('[data-act="editKg"][data-arg="9.5"]');
  a.click('[data-act="editSave"]');
  assert.deepStrictEqual({ ...a.state().sessions[0].exercises[0].sets[0] }, { reps: 10, kg: 9.5, done: true });
  a.click('[data-act="editSet"][data-arg="0"][data-arg2="0:1"]');
  a.click('[data-act="editDelete"]');
  assert.strictEqual(a.state().sessions[0].exercises[0].sets.length, 1);
  assert.deepStrictEqual(a.errors, []);
});

test('extra set en extra oefening tijdens een workout', () => {
  const a = boot();
  a.click('[data-act="start"]');
  a.click('[data-act="more"]');
  a.click('[data-act="addSet"]');
  assert.strictEqual(a.w.document.querySelectorAll('.sets .set').length, 5, 'Chest Press 4 -> 5 sets');
  a.click('[data-act="more"]');
  a.click('[data-act="addExOpen"]');
  a.click('[data-act="addEx"][data-arg="arnold-press"]');
  assert.strictEqual(a.$('.h1').textContent, 'Arnold Press');
  assert.match(a.text(), /Oefening 8 \/ 8/);
  a.click('[data-act="setDone"]');
  const st = a.state().active;
  assert.deepStrictEqual([...st.added], ['arnold-press']);
  assert.ok(st.exercises.find((e) => e.id === 'arnold-press').sets[0].done);
  const b = boot(a.state());
  assert.strictEqual(b.$('.h1').textContent, 'Arnold Press', 'overleeft herladen');
  assert.deepStrictEqual(a.errors, []);
});

test('schema aanpassen in Instellingen werkt door in de workout', () => {
  const a = boot();
  a.click('[data-act="tab"][data-arg="settings"]');
  a.click('[data-act="planOpen"]');
  a.click('[data-act="planDay"][data-arg="0"]');
  a.click('[data-act="planSets"][data-arg="0"][data-arg2="1"]');
  a.click('[data-act="planReps"][data-arg="0"]');
  a.click('[data-act="planRest"][data-arg="0"][data-arg2="15"]');
  a.click('[data-act="planRemove"][data-arg="6"]');
  a.click('[data-act="planAddOpen"]');
  a.click('[data-act="planAdd"][data-arg="arnold-press"]');
  a.click('[data-act="planMove"][data-arg="6"][data-arg2="-1"]');
  const p = a.state().plan[0].exercises;
  assert.deepStrictEqual([p[0].sets, p[0].reps, p[0].rest], [5, '8-12', 105]);
  assert.strictEqual(p.length, 7);
  assert.strictEqual(p[5].id, 'arnold-press');
  assert.ok(!p.some((x) => x.id === 'diamond-pushup'));
  a.click('[data-act="planBack"]'); a.click('[data-act="planBack"]');
  a.click('[data-act="tab"][data-arg="today"]');
  a.click('[data-act="start"]');
  assert.strictEqual(a.w.document.querySelectorAll('.sets .set').length, 5);
  const b = boot(a.state());
  assert.ok(b.state().plan, 'eigen schema blijft bewaard');
  b.w.eval('actions.finish()');
  b.click('[data-act="tab"][data-arg="settings"]');
  b.click('[data-act="planOpen"]');
  b.click('[data-act="planReset"]');
  assert.strictEqual(b.state().plan, null);
  assert.deepStrictEqual(a.errors, []);
});

test('kapot eigen schema valt terug op standaard', () => {
  const s = W2(); s.plan = [{ exercises: [{ id: 'bestaat-niet', sets: 3, reps: '8', kg: 1, rest: 60 }] }];
  const a = boot(s);
  assert.match(a.$('.h1').textContent, /Push A/);
  assert.deepStrictEqual(a.errors, []);
});

test('vermoeidheid: twee keer op rij minder reps geeft voorstel om lichter te gaan', () => {
  const e = (r) => [{ id: 'chest-press', name: 'Chest Press (vloer)', sets: [{ reps: r, kg: 12, done: true }, { reps: r, kg: 12, done: true }] }];
  const s = W2(); s.sessions = [sessAt(9, e(9)), sessAt(5, e(8)), sessAt(1, e(7))];
  const a = boot(s);
  a.click('[data-act="pick"][data-arg="0"]');
  a.click('[data-act="start"]');
  assert.match(a.text(), /Even een stap terug/);
  a.click('[data-act="applySuggest"]');
  assert.strictEqual(a.state().kg['chest-press'], 9.5);
});

test('Vandaag: focus en details standaard ingeklapt', () => {
  const a = boot();
  assert.match(a.text(), /van 3 gehaald/);
  assert.strictEqual(a.$('.goal'), null);
  a.click('[data-act="fold"][data-arg="focus"]');
  assert.strictEqual(a.w.document.querySelectorAll('.goal').length, 3);
});

test('standaardschema: benen kort voor lopers, meer schouders', () => {
  const a = boot();
  const P = a.w.eval('DEFAULT_PLAN');
  assert.strictEqual(P[2].exercises.map((x) => x.id).join(','), 'rdl,bulgarian,nordic,calf-single');
  assert.ok(P[0].exercises.some((x) => x.id === 'lateral-raise'), 'Push A heeft lateral raise');
  assert.strictEqual(P[4].exercises.find((x) => x.id === 'reverse-fly').sets, 4);
  assert.ok(a.w.eval('validPlan(DEFAULT_PLAN)'));
  a.click('[data-act="pick"][data-arg="2"]');
  a.click('[data-act="start"]');
  assert.strictEqual(a.$('.h1').textContent, 'Romanian Deadlift');
  assert.deepStrictEqual(a.errors, []);
});
