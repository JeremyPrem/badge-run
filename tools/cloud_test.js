// Exercises accounts + sync (src/cloud.js with src/app.js) against an in-memory fake of Supabase,
// including row-level security for shared links. Run: node tools/cloud_test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');

// ---- browser stubs ----
const store = new Map();
global.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const el = () => ({ innerHTML: '', textContent: '', hidden: false, value: '', options: [], classList: { add() {}, remove() {} },
  setAttribute() {}, querySelector: () => el(), focus() {}, select() {}, setSelectionRange() {}, dataset: {} });
const els = {};
global.document = { querySelector: s => (els[s] ||= el()), querySelectorAll: () => [], addEventListener() {} };
global.location = { search: '', pathname: '/badge-run/', origin: 'https://jeremyprem.github.io', hash: '', href: 'https://jeremyprem.github.io/badge-run/' };
global.history = { replaceState(_, __, url) { const u = new URL(url, location.origin); location.search = u.search; location.href = u.href; } };
global.navigator = {};
global.fetch = async url => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, url), 'utf8')) });
const toasts = [];

// ---- fake Supabase: one table with the schema.sql policies ----
const db = new Map();
let session = null;
function fakeClient() {
  const uid = () => session?.user.id;
  const visible = r => r.user_id === uid() || r.is_public;
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange() {},
      signInWithOAuth: async () => ({ error: null }),
      signOut: async () => { session = null; return { error: null }; },
    },
    from() {
      const q = { filters: [] };
      const run = () => [...db.values()].filter(visible).filter(r => q.filters.every(([k, v]) => r[k] === v));
      const chain = {
        select() { return chain; },
        eq(k, v) { q.filters.push([k, v]); return chain; },
        maybeSingle: async () => ({ data: run()[0] || null, error: null }),
        then(res) { return Promise.resolve(q.op === 'delete' ? doDelete() : { data: run(), error: null }).then(res); },
        upsert: async rows => {
          for (const r of rows) {
            if (!uid() || r.user_id !== uid()) return { error: { message: 'RLS: insert denied' } };
            const ex = db.get(r.id);
            if (ex && ex.user_id !== uid()) return { error: { message: 'RLS: update denied' } };
            db.set(r.id, { ...ex, ...r });
          }
          return { error: null };
        },
        delete() { q.op = 'delete'; return chain; },
      };
      const doDelete = () => { for (const r of run()) if (r.user_id === uid()) db.delete(r.id); return { error: null }; };
      return chain;
    },
  };
}
global.window = { scrollTo() {}, addEventListener() {}, supabase: { createClient: fakeClient },
  BADGE_RUN_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabaseKey: 'sb_publishable_test' } };

const src = ['src/types.js', 'src/cloud.js', 'src/app.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n')
  .replace(/\ninit\(\);\s*$/, '\n');
const wait = ms => new Promise(r => setTimeout(r, ms));

eval(src + `
toast = m => toasts.push(m);
(async () => {
  const cloud = window.cloud;
  // 1. Signed out: example team, then build a real team in the browser.
  await init();
  assert.equal(cloud.user, null);
  assert.equal(activeTeam().example, true, 'starts on the example team');
  handleClick({ target: { closest: s => s === '.picker' ? null : { dataset: { action: 'team-new' }, getAttribute() {} } } });
  addToTeam(6); addToTeam(9);
  activeTeam().name = 'Kanto run';
  teamChanged();
  const anonId = activeTeam().id;
  assert.equal(gameLib().teams.length, 2);

  // 2. Sign in: the browser team moves into the account and uploads; the example does not.
  session = { user: { id: 'user-a', user_metadata: { user_name: 'JeremyPrem' } } };
  await cloud.start();
  await wait(1100);
  assert.equal(cloud.user.id, 'user-a');
  assert.equal(state.owner, 'user-a');
  assert.ok(db.has(anonId), 'anonymous team uploaded on first sign-in');
  assert.equal(db.get(anonId).name, 'Kanto run');
  assert.equal(db.get(anonId).members.length, 2);
  assert.equal([...db.values()].filter(r => r.name === 'Example team').length, 0, 'example never uploaded');
  assert.equal(localStorage.getItem('badgerun.lib.anon'), null, 'anonymous library cleared after adopting');
  console.log('ok  sign-in adopts browser teams:', toasts.at(-1));

  // 3. Edits autosave (debounced).
  switchTeam(anonId);
  addToTeam(3);
  assert.equal(cloud.status, 'saving');
  await wait(1100);
  assert.equal(db.get(anonId).members.length, 3);
  assert.equal(cloud.status, 'saved');
  console.log('ok  edits autosave');

  // 4. Share link: public row readable signed out, copied (not linked) for another user.
  handleClick({ target: { closest: s => s === '.picker' ? null : { dataset: { action: 'share' }, getAttribute() {} } } });
  await wait(50);
  assert.equal(db.get(anonId).is_public, true);
  await cloud.signOut();
  assert.equal(state.owner, 'anon');
  assert.ok(!Object.values(state.lib).some(gl => gl.teams.some(t => t.id === anonId)), 'signed-out view has no account teams');
  location.search = '?team=' + anonId;
  await openSharedTeam();
  assert.notEqual(activeTeam().id, anonId, 'viewer gets a copy with a new id');
  assert.equal(activeTeam().name, 'Kanto run (shared)');
  assert.equal(activeTeam().members.length, 3);
  assert.equal(location.search, '', 'share param removed from the URL');
  console.log('ok  share link opens a copy:', toasts.at(-1));

  // 5. Stop sharing hides it again.
  session = { user: { id: 'user-a', user_metadata: {} } };
  await cloud.start(); await wait(1100);
  switchTeam(anonId);
  handleClick({ target: { closest: s => s === '.picker' ? null : { dataset: { action: 'unshare' }, getAttribute() {} } } });
  await wait(50);
  const saved = session; session = null;
  assert.equal(await cloud.fetchShared(anonId), null, 'unshared team not readable signed out');
  session = saved;
  console.log('ok  stop sharing');

  // 6. Another account can't overwrite it, even with the id.
  session = { user: { id: 'user-b', user_metadata: {} } };
  const r = await fakeClient().from('teams').upsert([{ id: anonId, user_id: 'user-b', game: 'x', name: 'hijack', members: [] }]);
  assert.ok(r.error, 'RLS blocks other users');
  session = saved;

  // 7. Delete removes it from the account; a second device's stale copy is dropped on next sign-in.
  const otherDevice = JSON.parse(localStorage.getItem('badgerun.lib.user-a'));
  handleClick({ target: { closest: s => s === '.picker' ? null : { dataset: { action: 'team-delete', confirm: 'yes' }, getAttribute() {}, set textContent(v) {} } } });
  await wait(50);
  assert.ok(!db.has(anonId), 'deleted from account');
  localStorage.setItem('badgerun.lib.user-a', JSON.stringify(otherDevice));
  cloud.user = null;
  await cloud.start(); await wait(1100);
  assert.ok(!Object.values(state.lib).some(gl => gl.teams.some(t => t.id === anonId)), 'stale copy removed after delete elsewhere');
  console.log('ok  delete syncs across devices');

  // 8. Invalid / missing share ids.
  assert.equal(await cloud.fetchShared('not-a-uuid'), null);
  console.log('ALL CLOUD TESTS PASSED');
})().catch(e => { console.error('FAIL', e); process.exit(1); });`);
