/* Badge Run: Pokémon team planner.
   Data: data/core.json (Pokémon + game list), data/games/<game>.json (dex, learnsets,
   encounters, boss teams), data/sprites.png + sprites.json (sprite sheet). */

const STORE_KEY = 'badgerun.v1';
const DEFAULT_GAME = 'firered-leafgreen';
const EXAMPLE_TEAMS = {
  'firered-leafgreen': [
    ['charizard', ['flamethrower', 'wing-attack', 'slash', 'dig']],
    ['lapras', ['surf', 'ice-beam', 'body-slam', 'confuse-ray']],
    ['jolteon', ['thunderbolt', 'double-kick', 'pin-missile', 'quick-attack']],
    ['nidoking', ['earthquake', 'ice-beam', 'thrash', 'horn-attack']],
    ['alakazam', ['psychic', 'calm-mind', 'recover', 'reflect']],
    ['snorlax', ['body-slam', 'rest', 'earthquake', 'shadow-ball']],
  ],
};
const CATEGORY_LABEL = {
  gym: 'Gym', trial: 'Trial', elite4: 'Elite Four', champion: 'Champion', rival: 'Rival',
  villain: 'Villain', postgame: 'Post-game', other: 'Story',
};
const STAT_LABELS = ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'];

const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'.:]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const data = { core: null, sprites: null, games: {} };
const state = {
  game: DEFAULT_GAME, version: -1, tab: 'dex', slot: 0,
  // Team library for whoever is using the page: { [gameKey]: { active: teamId, teams: [Team] } }
  // Team = { id, name, members: [{ p, moves }], isPublic, updatedAt, example?, syncedAt? }
  lib: {}, owner: 'anon',
  dex: { q: '', type: '', regional: true, wild: false, sort: 'dex' },
  learnFilter: 'L', openBattle: null, battleFilter: 'all',
  picker: null, // { slot, q, hi } while a moveset slot's search box is open
  teamMenu: null, // 'rename' | 'share' while that team-bar panel is open
};

/* ---------- persistence ----------
   Preferences live in STORE_KEY. Each library is stored separately: 'anon' for signed-out use,
   and one per signed-in account, so signing out never shows another person's teams. */
const libKey = owner => `badgerun.lib.${owner}`;
const newId = () => crypto.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16));

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (s) {
      Object.assign(state, { game: s.game || state.game, version: s.version ?? -1 });
      if (s.dex) Object.assign(state.dex, s.dex);
    }
    state.lib = readLib('anon');
    // v1 kept a single unnamed team per game in prefs; move those into the library once.
    if (s?.teams && !localStorage.getItem(libKey('anon'))) {
      for (const [g, members] of Object.entries(s.teams)) {
        if (Array.isArray(members) && members.length) {
          const t = { id: newId(), name: 'My team', members, isPublic: false, updatedAt: new Date().toISOString() };
          state.lib[g] = { active: t.id, teams: [t] };
        }
      }
      saveLib();
    }
  } catch { /* storage unavailable: start fresh */ }
}
function readLib(owner) {
  try { return JSON.parse(localStorage.getItem(libKey(owner)) || '{}') || {}; } catch { return {}; }
}
function saveLib() {
  try { localStorage.setItem(libKey(state.owner), JSON.stringify(state.lib)); } catch { /* ignore */ }
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ game: state.game, version: state.version, dex: state.dex }));
  } catch { /* ignore */ }
  saveLib();
}

/* ---------- team library ---------- */
function gameLib(key = state.game) {
  const gl = (state.lib[key] ||= { active: null, teams: [] });
  if (!gl.teams.length) gl.teams.push(blankTeam('Team 1'));
  if (!gl.teams.some(t => t.id === gl.active)) gl.active = gl.teams[0].id;
  return gl;
}
function blankTeam(name) {
  return { id: newId(), name, members: [], isPublic: false, updatedAt: new Date().toISOString() };
}
const activeTeam = () => { const gl = gameLib(); return gl.teams.find(t => t.id === gl.active); };
function uniqueTeamName(base, key = state.game) {
  const names = new Set(gameLib(key).teams.map(t => t.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
// Call after any change to the active team: saves locally and queues a cloud save when signed in.
function teamChanged(t = activeTeam()) {
  t.updatedAt = new Date().toISOString();
  delete t.example;
  save();
  window.cloud?.queue(t, state.game);
}

/* ---------- data helpers ---------- */
const game = () => data.games[state.game];
const team = () => activeTeam().members;
const mon = pid => data.core.pokemon[pid];
const displayName = p => p.form ? `${p.name} (${p.form})` : p.name;

function typesAt(p, gen) {
  if (p.pastTypes) {
    const gens = Object.keys(p.pastTypes).map(Number).sort((a, b) => a - b);
    for (const g of gens) if (gen <= g) return p.pastTypes[g];
  }
  return p.types;
}
function moveInfo(id) { return game().moves[id]; }
function machineLabel(id) {
  const n = game().tm[id];
  if (n == null) return 'TM';
  const g = game();
  if (g.key === 'sword-shield' && n >= 100) return 'TR' + String(n - 100).padStart(2, '0');
  if (n > 100 && g.gen < 7) return 'HM' + String(n - 100).padStart(2, '0');
  return 'TM' + String(n).padStart(2, '0');
}
function versionAllowed(mask) {
  return state.version < 0 || mask == null || (mask & (1 << state.version));
}
const bst = p => p.stats.reduce((a, b) => a + b, 0);

function sprite(pid, size = 48, cls = '') {
  const sp = data.sprites;
  const n = sp?.index[pid];
  if (n == null) return `<span class="sprite ${cls}" style="width:${size}px;height:${size}px"></span>`;
  const col = n % sp.cols, row = Math.floor(n / sp.cols);
  return `<span class="sprite ${cls}" style="width:${size}px;height:${size}px;background-size:${sp.cols * size}px ${sp.rows * size}px;background-position:-${col * size}px -${row * size}px"></span>`;
}
const typeChip = (t, small) => `<span class="type ${small ? 'sm' : ''}" style="--tc:${TYPE_COLORS[t]}">${esc(t)}</span>`;
const typeChips = (types, small) => types.map(t => typeChip(t, small)).join('');
function multLabel(m) {
  if (m === 0) return '0×';
  if (m === .25) return '¼×';
  if (m === .5) return '½×';
  return `${m}×`;
}
function multClass(m) {
  if (m === 0) return 'm0';
  if (m < 1) return 'mres';
  if (m === 1) return 'm1';
  if (m >= 4) return 'm4';
  return 'm2';
}

/* ---------- matchup engine ---------- */
function damagingMoves(moveIds) {
  return moveIds.map(id => ({ id, ...moveInfo(id) })).filter(m => m && m.cls !== 'status');
}
// Best attack from `attacker` into `defTypes`: considers chosen damaging moves, or falls back to STAB types.
function bestAttack(attackerTypes, moveIds, defTypes, gen) {
  const moves = damagingMoves(moveIds);
  let best = null;
  if (moves.length) {
    for (const m of moves) {
      const eff = effectiveness(m.type, defTypes, gen);
      const stab = attackerTypes.includes(m.type) ? 1.5 : 1;
      const score = eff * stab * ((m.power || 60) / 80);
      if (!best || score > best.score) best = { eff, move: m.name, type: m.type, stab: stab > 1, score };
    }
    return best;
  }
  for (const t of attackerTypes) {
    const eff = effectiveness(t, defTypes, gen);
    if (!best || eff > best.eff) best = { eff, move: null, type: t, stab: true, score: eff * 1.5, assumed: true };
  }
  return best;
}

function enemyEntry(m, gen) {
  const base = mon(m.p);
  const shown = m.mega ? mon(m.mega) : base;
  let types = typesAt(shown, gen);
  if (m.tera) types = [m.tera];
  return { ...m, p: base, shown, types, atkTypes: typesAt(shown, gen), moves: m.moves || [] };
}

function analyzeBattle(battle) {
  const g = game();
  const members = team().filter(t => t && mon(t.p)).map(t => ({ ...t, info: mon(t.p), types: typesAt(mon(t.p), g.gen) }));
  const enemies = battle.team.map(m => enemyEntry(m, g.gen));
  const rows = enemies.map(e => {
    const cells = members.map(mem => {
      const off = bestAttack(mem.types, mem.moves || [], e.types, g.gen);
      const def = bestAttack(e.atkTypes, e.moves, mem.types, g.gen);
      return { off, def };
    });
    const answers = cells.filter(c => c.off.eff >= 2 && c.def.eff <= 1).length;
    const trades = cells.filter(c => c.off.eff >= 2 && c.def.eff > 1).length;
    const walls = cells.filter(c => c.def.eff < 1 && c.off.eff >= 1).length;
    const status = answers ? 'good' : (trades || walls) ? 'ok' : 'bad';
    return { enemy: e, cells, answers, status };
  });
  const pts = rows.reduce((a, r) => a + (r.status === 'good' ? 1 : r.status === 'ok' ? .5 : 0), 0);
  const score = rows.length ? pts / rows.length : 0;
  // Members hit super-effectively by at least half the enemy team.
  const danger = members.map((mem, i) => ({
    mem, hits: rows.filter(r => r.cells[i].def.eff >= 2).length,
  })).filter(d => d.hits && d.hits >= Math.ceil(rows.length / 2));
  const verdict = !members.length ? 'none' : score >= .8 ? 'favored' : score >= .5 ? 'even' : 'risky';
  return { members, rows, score, verdict, danger };
}
const VERDICT_LABEL = { favored: 'Favored', even: 'Even', risky: 'Risky', none: 'No team' };

/* ---------- loading ---------- */
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Couldn't load ${url} (${r.status})`);
  return r.json();
}
async function ensureGame(key) {
  if (!data.games[key]) data.games[key] = await getJSON(`data/games/${key}.json`);
  return data.games[key];
}
// A brand-new library gets the example team (never saved to an account until it's edited).
function seedExample(key) {
  const g = data.games[key];
  if (state.lib[key]?.teams?.length || !EXAMPLE_TEAMS[key]) return;
  const byKey = {};
  for (const [pid, p] of Object.entries(data.core.pokemon)) byKey[p.key] = Number(pid);
  const moveByKey = {};
  for (const [id, m] of Object.entries(g.moves)) moveByKey[slug(m.name)] = Number(id);
  const t = blankTeam('Example team');
  t.example = true;
  t.members = EXAMPLE_TEAMS[key].map(([k, mvs]) => {
    const pid = byKey[k];
    const learn = new Set((g.pokemon[pid]?.l || []).map(e => e[0]));
    return { p: pid, moves: mvs.map(mk => moveByKey[mk]).filter(id => id && learn.has(id)).slice(0, 4) };
  }).filter(m => m.p);
  state.lib[key] = { active: t.id, teams: [t] };
}

async function selectGame(key) {
  state.game = key;
  $('#app').classList.add('loading');
  try {
    await ensureGame(key);
  } catch (err) {
    $('#workspace').innerHTML = `<p class="empty">${esc(err.message)}. Check that the data folder sits next to this page.</p>`;
    return;
  } finally {
    $('#app').classList.remove('loading');
  }
  const g = game();
  if (state.version >= g.versions.length) state.version = -1;
  seedExample(key);
  team().splice(6);
  state.slot = Math.min(state.slot, Math.max(0, team().length - 1));
  state.openBattle = null;
  state.picker = null;
  state.teamMenu = null;
  save();
  renderAll();
}

function switchTeam(id) {
  gameLib().active = id;
  state.slot = 0; state.picker = null; state.teamMenu = null;
  save();
  renderAll();
}

/* ---------- rendering ---------- */
function renderAll() {
  renderControls();
  renderAccount();
  renderTeam();
  renderTabs();
  renderWorkspace();
}

function renderControls() {
  const sel = $('#game');
  if (!sel.options.length) {
    const byGen = {};
    for (const g of data.core.games) (byGen[g.gen] ||= []).push(g);
    sel.innerHTML = Object.entries(byGen).map(([gen, gs]) =>
      `<optgroup label="Generation ${gen}">${gs.map(g => `<option value="${g.key}">${esc(g.name)}</option>`).join('')}</optgroup>`).join('');
  }
  sel.value = state.game;
  const g = game();
  $('#version').innerHTML = `<option value="-1">Both versions</option>` +
    g.versions.map((v, i) => `<option value="${i}">${esc(v.name)}</option>`).join('');
  $('#version').value = String(state.version);
  $('#version').hidden = g.versions.length < 2;
  $('#game-meta').textContent = `${g.region} · Gen ${g.gen}`;
}

function renderTeam() {
  const g = game();
  const t = team();
  const slots = [];
  for (let i = 0; i < 6; i++) {
    const m = t[i];
    if (!m) {
      slots.push(`<li><button class="slot empty-slot" data-action="add-slot" data-i="${i}">
        <span class="slot-num">${i + 1}</span><span>Add a Pokémon</span></button></li>`);
      continue;
    }
    const p = mon(m.p);
    const types = typesAt(p, g.gen);
    const moves = (m.moves || []).map(id => moveInfo(id)).filter(Boolean);
    slots.push(`<li><div class="slot ${state.slot === i ? 'active' : ''}" data-action="select-slot" data-i="${i}" tabindex="0" role="button" aria-label="Edit ${esc(displayName(p))}">
      ${sprite(m.p, 56)}
      <div class="slot-body">
        <div class="slot-head"><strong>${esc(displayName(p))}</strong>${typeChips(types, true)}</div>
        <ul class="slot-moves">${[0, 1, 2, 3].map(k => moves[k]
          ? `<li style="--tc:${TYPE_COLORS[moves[k].type]}" data-action="quick-move" data-i="${i}" data-k="${k}" title="Change move">${esc(moves[k].name)}</li>`
          : `<li class="nomove" data-action="quick-move" data-i="${i}" data-k="${k}" title="Choose a move">+ move</li>`).join('')}</ul>
      </div>
      <button class="icon-btn remove" data-action="remove" data-i="${i}" aria-label="Remove ${esc(displayName(p))}" title="Remove">×</button>
    </div></li>`);
  }
  $('#team-list').innerHTML = slots.join('');
  $('#team-count').textContent = `${t.length}/6`;
  $('#example-note').hidden = !activeTeam().example;
  renderTeamBar();
  renderTeamWeakness();
}

function shareUrl(t) {
  return `${location.origin}${location.pathname}?team=${t.id}`;
}

function renderTeamBar() {
  const gl = gameLib();
  const t = activeTeam();
  const signedIn = !!window.cloud?.user;
  let panel = '';
  if (state.teamMenu === 'rename') {
    panel = `<form class="team-panel" data-form="rename">
      <label for="team-name" class="label">Team name</label>
      <div class="row"><input id="team-name" type="text" maxlength="60" value="${esc(t.name)}" autocomplete="off" required>
      <button class="btn sm" type="submit">Save</button><button class="btn sm ghost" type="button" data-action="team-menu" data-m="">Cancel</button></div>
    </form>`;
  } else if (state.teamMenu === 'share') {
    panel = !signedIn
      ? `<div class="team-panel"><p class="small">Sign in to get a share link for this team.</p>
          <div class="row">${window.cloud?.enabled ? '<button class="btn sm" data-action="sign-in">Sign in with Google</button>' : ''}<button class="btn sm ghost" data-action="team-menu" data-m="">Close</button></div></div>`
      : t.isPublic
        ? `<div class="team-panel"><label for="share-link" class="label">Anyone with this link can view and copy the team</label>
            <div class="row"><input id="share-link" type="text" readonly value="${esc(shareUrl(t))}">
            <button class="btn sm" data-action="copy-link">Copy</button></div>
            <div class="row"><button class="btn sm ghost" data-action="unshare">Stop sharing</button><button class="btn sm ghost" data-action="team-menu" data-m="">Close</button></div></div>`
        : `<div class="team-panel"><p class="small">Make a link that anyone can open to view and copy “${esc(t.name)}”. You can turn it off any time.</p>
            <div class="row"><button class="btn sm" data-action="share">Create share link</button><button class="btn sm ghost" data-action="team-menu" data-m="">Cancel</button></div></div>`;
  }
  $('#team-bar').innerHTML = `
    <div class="team-switch">
      <label for="team-select" class="sr">Saved teams for ${esc(game().name)}</label>
      <select id="team-select">${gl.teams.map(x => `<option value="${x.id}" ${x.id === gl.active ? 'selected' : ''}>${esc(x.name)}${x.isPublic ? ' · shared' : ''} (${x.members.length})</option>`).join('')}</select>
      <button class="btn sm ghost" data-action="team-new" title="Start a new empty team">New</button>
    </div>
    <div class="team-tools">
      <button class="linkish" data-action="team-menu" data-m="rename">Rename</button>
      <button class="linkish" data-action="team-dup">Duplicate</button>
      <button class="linkish" data-action="team-menu" data-m="share">${t.isPublic ? 'Shared ✓' : 'Share'}</button>
      <button class="linkish danger" data-action="team-delete">Delete</button>
    </div>
    ${panel}`;
}

function renderAccount() {
  const el = $('#account');
  const c = window.cloud;
  if (!c?.enabled) { el.innerHTML = ''; return; }
  if (!c.user) {
    el.innerHTML = `<button class="btn sm signin" data-action="sign-in" title="Save your teams to your account and use them on any device">
      <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>
      Sign in with Google</button>`;
    return;
  }
  const u = c.user;
  const name = u.user_metadata?.full_name || u.user_metadata?.name || u.user_metadata?.user_name || u.email || 'Signed in';
  const avatar = u.user_metadata?.avatar_url || u.user_metadata?.picture;
  el.innerHTML = `<div class="who">
      ${avatar ? `<img src="${esc(avatar)}" alt="" width="28" height="28">` : ''}
      <div><strong>${esc(name)}</strong><span class="sync sync-${c.status}">${esc(c.statusText())}</span></div>
      <button class="btn sm ghost" data-action="sign-out">Sign out</button>
    </div>`;
}

function renderTeamWeakness() {
  const g = game();
  const members = team().map(t => typesAt(mon(t.p), g.gen));
  if (!members.length) { $('#team-weak').innerHTML = ''; return; }
  const rows = typesForGen(g.gen).map(atk => {
    const effs = members.map(d => effectiveness(atk, d, g.gen));
    return { atk, weak: effs.filter(e => e > 1).length, resist: effs.filter(e => e < 1).length };
  });
  const weak = rows.filter(r => r.weak >= 2 && r.weak > r.resist).sort((a, b) => b.weak - a.weak);
  const unresisted = rows.filter(r => r.resist === 0 && r.weak > 0);
  $('#team-weak').innerHTML = `
    <div><span class="label">Shared weaknesses</span><div class="chips">${weak.length ? weak.map(r =>
      `<span class="type sm" style="--tc:${TYPE_COLORS[r.atk]}">${r.atk} <b>${r.weak}</b></span>`).join('') : '<span class="muted">None</span>'}</div></div>
    <div><span class="label">Nothing resists</span><div class="chips">${unresisted.length ? unresisted.map(r => typeChip(r.atk, true)).join('') : '<span class="muted">Every type is resisted</span>'}</div></div>`;
}

function renderTabs() {
  const sel = team()[state.slot];
  const label = sel ? displayName(mon(sel.p)) : 'Moves & locations';
  document.querySelectorAll('.tab').forEach(b => {
    b.setAttribute('aria-selected', String(b.dataset.tab === state.tab));
    if (b.dataset.tab === 'member') b.textContent = label;
  });
}

function renderWorkspace() {
  const el = $('#workspace');
  if (state.tab === 'dex') el.innerHTML = renderDex();
  else if (state.tab === 'member') el.innerHTML = renderMember();
  else if (state.tab === 'battles') el.innerHTML = renderBattles();
  else el.innerHTML = renderCoverage();
}

/* Pokédex tab */
function dexList() {
  const g = game();
  const { q, type, regional, wild, sort } = state.dex;
  const query = q.trim().toLowerCase();
  let list = Object.entries(g.pokemon).map(([pid, gp]) => ({ pid, gp, p: mon(pid) }))
    .filter(x => x.p && !x.p.battleOnly);
  if (regional && g.dexes.length) list = list.filter(x => x.gp.d);
  if (wild) list = list.filter(x => x.gp.e?.length);
  if (type) list = list.filter(x => typesAt(x.p, g.gen).includes(type));
  if (query) list = list.filter(x => displayName(x.p).toLowerCase().includes(query) || String(x.p.species) === query);
  const dexNo = x => x.gp.d ? (x.gp.d.findIndex(n => n != null) * 10000 + x.gp.d.find(n => n != null)) : 1e6 + x.p.species;
  if (sort === 'dex') list.sort((a, b) => dexNo(a) - dexNo(b) || a.p.id - b.p.id);
  else if (sort === 'name') list.sort((a, b) => displayName(a.p).localeCompare(displayName(b.p)));
  else list.sort((a, b) => bst(b.p) - bst(a.p));
  return list;
}

function renderDex() {
  const g = game();
  const list = dexList();
  const inTeam = new Set(team().map(t => String(t.p)));
  const full = team().length >= 6;
  const regionalName = g.dexes.length ? g.dexes.join(' + ') : '';
  return `
    <div class="toolbar">
      <label class="search"><span class="sr">Search Pokémon</span>
        <input id="dex-q" type="search" placeholder="Search by name or No." value="${esc(state.dex.q)}" autocomplete="off"></label>
      <label><span class="sr">Filter by type</span><select id="dex-type"><option value="">All types</option>
        ${typesForGen(g.gen).map(t => `<option value="${t}" ${state.dex.type === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select></label>
      <label><span class="sr">Sort</span><select id="dex-sort">
        <option value="dex" ${state.dex.sort === 'dex' ? 'selected' : ''}>Dex order</option>
        <option value="name" ${state.dex.sort === 'name' ? 'selected' : ''}>Name</option>
        <option value="bst" ${state.dex.sort === 'bst' ? 'selected' : ''}>Base stat total</option></select></label>
      ${regionalName ? `<label class="check"><input id="dex-regional" type="checkbox" ${state.dex.regional ? 'checked' : ''}> ${esc(regionalName)} Dex only</label>` : ''}
      ${g.hasEncounters ? `<label class="check"><input id="dex-wild" type="checkbox" ${state.dex.wild ? 'checked' : ''}> Catchable in the wild</label>` : ''}
    </div>
    <p class="result-count">${list.length} Pokémon in ${esc(g.name)}${full ? ' · Team is full: remove a member to add another' : ''}</p>
    <ul class="dex-grid">${list.map(({ pid, gp, p }) => {
      const no = gp.d ? gp.d.find(n => n != null) : null;
      return `<li><button class="dex-card ${inTeam.has(pid) ? 'in-team' : ''}" data-action="add" data-p="${pid}" ${full ? 'aria-disabled="true"' : ''} title="${full ? 'Team is full' : 'Add to team'}">
        ${sprite(pid, 64)}
        <span class="dex-no">${no != null ? '#' + String(no).padStart(3, '0') : 'Nat. #' + p.species}</span>
        <span class="dex-name">${esc(displayName(p))}</span>
        <span class="chips">${typeChips(typesAt(p, g.gen), true)}</span>
        <span class="dex-bst">BST ${bst(p)}${gp.e?.length ? ' · <span class="wild">wild</span>' : ''}</span>
      </button></li>`;
    }).join('')}</ul>
    ${list.length ? '' : `<p class="empty">No Pokémon match these filters.</p>`}`;
}

/* Member tab: moves + locations */
function renderMember() {
  const g = game();
  const m = team()[state.slot];
  if (!m) return `<p class="empty">Pick a team member on the left, or add one from the <button class="link" data-action="tab" data-tab="dex">Pokédex</button>.</p>`;
  const p = mon(m.p);
  const gp = g.pokemon[m.p] || { l: [] };
  const types = typesAt(p, g.gen);
  const chosen = m.moves || [];
  const counts = { L: 0, M: 0, T: 0, E: 0 };
  for (const e of gp.l) counts[e[1]]++;
  const filter = counts[state.learnFilter] ? state.learnFilter : 'L';
  const rows = gp.l.filter(e => e[1] === filter);
  const maxStat = 255;
  return `
    <section class="member-head">
      ${sprite(m.p, 96, 'big')}
      <div>
        <h2>${esc(displayName(p))}</h2>
        <div class="chips">${typeChips(types)}</div>
        ${p.from && mon(p.from) ? `<p class="muted small">Evolves from <button class="link" data-action="jump" data-p="${p.from}">${esc(mon(p.from).name)}</button></p>` : ''}
      </div>
      <dl class="stats">${p.stats.map((s, i) => `<div><dt>${STAT_LABELS[i]}</dt><dd><span class="bar" style="--w:${Math.min(100, s / maxStat * 100 * 1.6)}%"></span><span class="num">${s}</span></dd></div>`).join('')}
        <div class="total"><dt>Total</dt><dd><span class="num">${bst(p)}</span></dd></div></dl>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>Moveset</h3><span class="muted small">${chosen.length}/4 chosen</span></div>
      <ol class="moveset">${[0, 1, 2, 3].map(i => renderMoveSlot(i, chosen)).join('')}</ol>
      <p class="muted small hint">Click a slot to search ${esc(p.name)}'s ${new Set(gp.l.map(e => e[0])).size} learnable moves by name, type or category.</p>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>Learnable moves</h3>
        <div class="seg" role="tablist">${[['L', 'Level up'], ['M', 'TM / HM'], ['T', 'Tutor'], ['E', 'Egg']].filter(([k]) => counts[k]).map(([k, l]) =>
          `<button role="tab" aria-selected="${filter === k}" data-action="learn-filter" data-f="${k}">${l} <span class="count">${counts[k]}</span></button>`).join('')}</div>
      </div>
      ${rows.length ? `<div class="table-wrap"><table class="moves">
        <thead><tr><th>${filter === 'L' ? 'Lv' : filter === 'M' ? 'TM' : ''}</th><th>Move</th><th>Type</th><th>Cat.</th><th class="r">Pow</th><th class="r">Acc</th><th></th></tr></thead>
        <tbody>${rows.map(([id, code, lvl]) => {
          const mv = moveInfo(id);
          if (!mv) return '';
          const has = chosen.includes(id);
          const how = code === 'L' ? (lvl ? lvl : 'Evo') : code === 'M' ? machineLabel(id) : '';
          return `<tr class="${has ? 'chosen' : ''}"><td class="num">${how}</td><td>${esc(mv.name)}</td><td>${typeChip(mv.type, true)}</td>
            <td><span class="cls cls-${mv.cls}">${mv.cls}</span></td><td class="num r">${mv.power ?? '—'}</td><td class="num r">${mv.acc ?? '—'}</td>
            <td class="r">${has ? `<button class="btn sm ghost" data-action="unmove" data-m="${id}">Remove</button>`
              : `<button class="btn sm" data-action="move" data-m="${id}" ${chosen.length >= 4 ? 'disabled title="Moveset is full"' : ''}>Add</button>`}</td></tr>`;
        }).join('')}</tbody></table></div>` : `<p class="empty">No moves recorded for this Pokémon in ${esc(g.name)}.</p>`}
    </section>

    <section class="panel">
      <div class="panel-head"><h3>Where to find it</h3>${g.versions.length > 1 ? `<span class="muted small">${state.version < 0 ? 'Showing both versions' : 'Showing ' + esc(g.versions[state.version].name)}</span>` : ''}</div>
      ${renderEncounters(m.p, p)}
    </section>`;
}

/* Move picker: a searchable combobox per moveset slot. */
const METHOD_ORDER = { L: 0, M: 1, T: 2, E: 3 };
function moveSource(code, lvl, id) {
  if (code === 'L') return lvl ? `Lv ${lvl}` : 'Evo';
  if (code === 'M') return machineLabel(id);
  return code === 'T' ? 'Tutor' : 'Egg';
}

function renderMoveSlot(i, chosen) {
  const id = chosen[i];
  const mv = id && moveInfo(id);
  if (state.picker?.slot === i) {
    const opts = pickerOptions();
    return `<li class="picker" style="--tc:${mv ? TYPE_COLORS[mv.type] : 'var(--line)'}">
      <input id="move-search" type="text" role="combobox" autocomplete="off" spellcheck="false"
        aria-expanded="true" aria-controls="move-options" aria-autocomplete="list"
        aria-activedescendant="${opts.length ? 'mopt-' + Math.min(state.picker.hi, opts.length - 1) : ''}"
        aria-label="Search moves for slot ${i + 1}" placeholder="${mv ? 'Replace ' + esc(mv.name) + '…' : 'Search moves…'}" value="${esc(state.picker.q)}">
      <ul id="move-options" class="move-options" role="listbox">${renderPickerOptions(opts)}</ul>
    </li>`;
  }
  if (!mv) {
    return `<li class="nomove"><button class="slot-pick" data-action="open-picker" data-k="${i}">
      <span class="plus">+</span> Choose move ${i + 1}</button></li>`;
  }
  return `<li style="--tc:${TYPE_COLORS[mv.type]}">
    <button class="slot-pick" data-action="open-picker" data-k="${i}" title="Change move">
      <span class="mv-name">${esc(mv.name)}</span>${typeChip(mv.type, true)}
      <span class="mv-meta">${mv.cls}${mv.power ? ' · ' + mv.power + ' pow' : ''}</span>
      <span class="caret" aria-hidden="true">▾</span></button>
    <button class="icon-btn" data-action="unmove" data-m="${id}" aria-label="Remove ${esc(mv.name)}">×</button></li>`;
}

// Learnable moves matching the picker query; best source per move (level-up first).
function pickerOptions() {
  const m = team()[state.slot];
  if (!m || !state.picker) return [];
  const g = game();
  const current = (m.moves || [])[state.picker.slot];
  const taken = new Set((m.moves || []).filter(id => id !== current));
  const seen = new Map();
  for (const [id, code, lvl] of g.pokemon[m.p]?.l || []) {
    if (taken.has(id) || !moveInfo(id)) continue;
    const prev = seen.get(id);
    if (!prev || METHOD_ORDER[code] < METHOD_ORDER[prev.code]) seen.set(id, { id, code, lvl });
  }
  const q = state.picker.q.trim().toLowerCase();
  const types = typesAt(mon(m.p), g.gen);
  const opts = [];
  for (const o of seen.values()) {
    const mv = moveInfo(o.id);
    const name = mv.name.toLowerCase();
    let rank;
    if (!q) rank = 3;
    else if (name.startsWith(q)) rank = 0;
    else if (name.split(/[\s-]/).some(w => w.startsWith(q))) rank = 1;
    else if (name.includes(q) || mv.type === q || mv.cls === q || (q === 'stab' && types.includes(mv.type))) rank = 2;
    else continue;
    opts.push({ ...o, mv, rank, stab: types.includes(mv.type) && mv.cls !== 'status' });
  }
  // With no query, show strongest STAB/damaging moves first so the obvious picks are on top.
  return opts.sort((a, b) => a.rank - b.rank ||
    (q ? a.mv.name.localeCompare(b.mv.name)
       : (b.stab - a.stab) || ((b.mv.power || 0) - (a.mv.power || 0)) || a.mv.name.localeCompare(b.mv.name)));
}

function renderPickerOptions(opts) {
  if (!opts.length) return `<li class="opt-empty" role="presentation">No learnable move matches “${esc(state.picker.q)}”.</li>`;
  const hi = Math.min(state.picker.hi, opts.length - 1);
  return opts.map((o, n) => `<li id="mopt-${n}" role="option" aria-selected="${n === hi}" class="opt ${n === hi ? 'hi' : ''}" data-action="pick-move" data-m="${o.id}" data-n="${n}">
    <span class="opt-name">${esc(o.mv.name)}${o.stab ? '<span class="stab" title="Same-type attack bonus">STAB</span>' : ''}</span>
    ${typeChip(o.mv.type, true)}
    <span class="cls cls-${o.mv.cls}">${o.mv.cls}</span>
    <span class="num opt-pow">${o.mv.power ?? '—'}</span>
    <span class="opt-src">${moveSource(o.code, o.lvl, o.id)}</span></li>`).join('');
}

function openPicker(k) {
  state.picker = { slot: k, q: '', hi: 0 };
  renderWorkspace();
  const input = $('#move-search');
  input?.focus();
  input?.closest('.panel')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function closePicker(rerender = true) {
  if (!state.picker) return;
  state.picker = null;
  if (rerender) renderWorkspace();
}
function refreshPickerList() {
  const opts = pickerOptions();
  const list = $('#move-options');
  if (!list) return;
  list.innerHTML = renderPickerOptions(opts);
  const hi = Math.min(state.picker.hi, opts.length - 1);
  $('#move-search').setAttribute('aria-activedescendant', opts.length ? 'mopt-' + hi : '');
  list.querySelector('.hi')?.scrollIntoView({ block: 'nearest' });
}
function pickMove(id) {
  const m = team()[state.slot];
  if (!m || !state.picker) return;
  const moves = (m.moves ||= []);
  const k = state.picker.slot;
  if (k < moves.length) moves[k] = id; else moves.push(id);
  m.moves = moves.slice(0, 4);
  // Move straight on to the next empty slot, so filling a set is type → Enter ×4.
  const next = m.moves.length < 4 ? m.moves.length : null;
  state.picker = null;
  teamChanged();
  renderTeam();
  if (next != null) openPicker(next); else renderWorkspace();
  toast(`${moveInfo(id).name} added`);
}
function handlePickerKey(e) {
  if (!state.picker) return;
  const opts = pickerOptions();
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!opts.length) return;
    const d = e.key === 'ArrowDown' ? 1 : -1;
    state.picker.hi = (Math.min(state.picker.hi, opts.length - 1) + d + opts.length) % opts.length;
    refreshPickerList();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const o = opts[Math.min(state.picker.hi, opts.length - 1)];
    if (o) pickMove(o.id);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closePicker();
  }
}

const ENC_PREVIEW_ROWS = 6;

// The Pokémon followed by each pre-evolution, nearest first (e.g. Charizard, Charmeleon, Charmander).
function evolutionLine(p) {
  const line = [p];
  let cur = p;
  while (cur.from && mon(cur.from) && line.length < 4) {
    cur = mon(cur.from);
    line.push(cur);
  }
  return line;
}

function renderEncounters(pid, p) {
  const g = game();
  if (!g.hasEncounters) return `<p class="empty">Encounter locations for ${esc(g.name)} aren't in the PokeAPI dataset yet, so they can't be shown here.</p>`;
  const where = state.version < 0 ? g.name : g.versions[state.version].name;
  const stages = evolutionLine(p).map((s, i) => ({
    s, i, enc: (g.pokemon[i === 0 ? pid : s.id]?.e || []).filter(e => versionAllowed(e[4])),
  }));

  // Earliest catch anywhere in the line: lowest encounter level, so you know how soon you can start it.
  let earliest = null;
  for (const st of stages) for (const e of st.enc) if (!earliest || e[2] < earliest.e[2]) earliest = { st, e };
  const summary = earliest
    ? `<p class="enc-summary">Earliest catch in this line: <b>${esc(displayName(earliest.st.s))}</b> at <b>${esc(earliest.e[0])}</b>
        <span class="muted">(${esc(earliest.e[1])}, Lv ${earliest.e[2]})</span>${earliest.st.i ? ` then evolve it into ${esc(displayName(p))}.` : '.'}</p>`
    : `<p class="empty">Nothing in the ${esc(p.name)} line can be caught in the wild in ${esc(where)}. It may be a gift, a trade, an event, or exclusive to the other version.</p>`;

  return summary + stages.map(({ s, i, enc }) => `
    <div class="enc-stage">
      <div class="enc-stage-head">
        ${sprite(s.id, 40)}
        <div>
          ${i === 0 ? `<strong>${esc(displayName(s))}</strong>`
            : `<button class="link" data-action="jump" data-p="${s.id}">${esc(displayName(s))}</button>`}
          <span class="stage-tag">${i === 0 ? 'This Pokémon' : `Pre-evolution · evolves into ${esc(stages[i - 1].s.name)}`}</span>
        </div>
        <span class="muted small enc-count">${enc.length ? `${enc.length} location${enc.length === 1 ? '' : 's'}` : ''}</span>
      </div>
      ${enc.length ? encounterTable(enc, s.id) : `<p class="muted small enc-none">Not found in the wild in ${esc(where)}.</p>`}
    </div>`).join('');
}

function encounterTable(list, key) {
  const g = game();
  const multi = g.versions.length > 1;
  const open = state.encOpen?.has(key);
  const rows = open ? list : list.slice(0, ENC_PREVIEW_ROWS);
  return `<div class="table-wrap"><table class="enc">
    <thead><tr><th>Location</th><th>Method</th><th class="r">Levels</th><th class="r">Rate</th>${multi ? '<th>Version</th>' : ''}<th>Conditions</th></tr></thead>
    <tbody>${rows.map(([loc, method, lo, hi, mask, rate, cond]) => `<tr>
      <td>${esc(loc)}</td><td>${esc(method)}</td><td class="num r">${lo === hi ? lo : lo + '–' + hi}</td>
      <td class="num r">${rate ? rate + '%' : '—'}</td>
      ${multi ? `<td>${g.versions.map((v, i) => mask & (1 << i) ? `<span class="ver v${i}">${esc(v.name)}</span>` : '').join(' ')}</td>` : ''}
      <td class="small">${cond ? cond.map(esc).join(', ') : ''}</td></tr>`).join('')}</tbody></table></div>
    ${list.length > ENC_PREVIEW_ROWS ? `<button class="btn sm ghost enc-more" data-action="enc-more" data-k="${key}">${open ? 'Show fewer' : `Show all ${list.length} locations`}</button>` : ''}`;
}

/* Battles tab */
function renderBattles() {
  const g = game();
  const battles = g.bosses.filter(b => versionAllowed(b.v));
  if (!g.bosses.length) return `<p class="empty">Boss teams for ${esc(g.name)} haven't been added yet.</p>`;
  const cats = [...new Set(battles.map(b => b.category))];
  const shown = battles.filter(b => state.battleFilter === 'all' || b.category === state.battleFilter);
  const analyses = shown.map(b => ({ b, a: analyzeBattle(b) }));
  const summary = { favored: 0, even: 0, risky: 0 };
  analyses.forEach(({ a }) => summary[a.verdict] != null && summary[a.verdict]++);
  return `
    <div class="toolbar">
      <div class="seg">${['all', ...cats].map(c => `<button aria-selected="${state.battleFilter === c}" data-action="battle-filter" data-f="${c}">${c === 'all' ? 'All' : CATEGORY_LABEL[c] || c}</button>`).join('')}</div>
    </div>
    ${team().length ? `<div class="summary">
      <div><span class="pill favored">${summary.favored}</span> favored</div>
      <div><span class="pill even">${summary.even}</span> even</div>
      <div><span class="pill risky">${summary.risky}</span> risky</div>
      <p class="muted small">Based on type matchups between your chosen moves and each opponent's real moveset. Levels, abilities, items and stats aren't simulated.</p>
    </div>` : `<p class="empty">Add Pokémon to your team to see how they match up.</p>`}
    <ol class="battles">${analyses.map(({ b, a }) => renderBattle(b, a)).join('')}</ol>`;
}

function renderBattle(b, a) {
  const open = state.openBattle === b.id + (b.variant || '') + (b.v || '');
  const key = b.id + (b.variant || '') + (b.v || '');
  return `<li class="battle ${open ? 'open' : ''}">
    <button class="battle-row" data-action="toggle-battle" data-k="${esc(key)}" aria-expanded="${open}">
      <span class="cat cat-${b.category}">${CATEGORY_LABEL[b.category] || b.category}</span>
      <span class="battle-title"><strong>${esc(b.name)}</strong> <span class="muted">${esc(b.title)}</span>
        ${b.variant ? `<span class="variant">${esc(b.variant)}</span>` : ''}</span>
      <span class="battle-team">${b.team.map(m => sprite(m.mega || m.p, 36)).join('')}</span>
      <span class="battle-meta">${b.type ? typeChip(b.type, true) : ''}<span class="lvl">Lv ${b.levelCap ?? Math.max(...b.team.map(m => m.lv || 0))}</span></span>
      <span class="pill ${a.verdict}">${VERDICT_LABEL[a.verdict]}${a.members.length ? ` <small>${Math.round(a.score * 100)}%</small>` : ''}</span>
    </button>
    ${open ? renderMatrix(b, a) : ''}
  </li>`;
}

function renderMatrix(b, a) {
  if (!a.members.length) return `<div class="matrix-wrap"><p class="empty">Add team members to compare.</p></div>`;
  const statusText = { good: 'Answered', ok: 'Manageable', bad: 'No answer' };
  return `<div class="matrix-wrap">
    ${a.danger.length ? `<p class="warn">Watch out: ${a.danger.map(d => `<b>${esc(displayName(d.mem.info))}</b> is hit super-effectively by ${d.hits} of ${a.rows.length}`).join('; ')}.</p>` : ''}
    <div class="table-wrap"><table class="matrix">
      <thead><tr><th>Opponent</th>${a.members.map(m => `<th class="mem">${sprite(m.p, 40)}<span>${esc(m.info.name)}</span></th>`).join('')}<th>Verdict</th></tr></thead>
      <tbody>${a.rows.map(r => {
        const e = r.enemy;
        const mvNames = e.moves.map(id => moveInfo(id)?.name).filter(Boolean);
        return `<tr>
          <th scope="row" class="enemy">${sprite(e.shown.id, 40)}
            <div><strong>${esc(e.mega ? displayName(e.shown) : e.p.name)}</strong> <span class="lvl">Lv ${e.lv}</span>
            <div class="chips">${typeChips(e.types, true)}${e.tera ? '<span class="tag">Tera</span>' : ''}${e.dynamax || e.gmax ? `<span class="tag">${e.gmax ? 'G-Max' : 'Dynamax'}</span>` : ''}</div>
            ${mvNames.length ? `<div class="enemy-moves">${mvNames.map(esc).join(' · ')}</div>` : ''}
            ${e.item ? `<div class="enemy-moves">@ ${esc(e.item)}</div>` : ''}</div></th>
          ${r.cells.map(c => `<td class="cell">
            <span class="off ${multClass(c.off.eff)}" title="Your best: ${esc(c.off.move || c.off.type + ' STAB (no moves chosen)')}">↗ ${multLabel(c.off.eff)}</span>
            <span class="def ${multClass(c.def.eff)}" title="Their best: ${esc(c.def.move || c.def.type + ' STAB')}">↙ ${multLabel(c.def.eff)}</span>
            <span class="cell-move">${esc(c.off.move || (c.off.type + '*'))}</span></td>`).join('')}
          <td><span class="status s-${r.status}">${statusText[r.status]}</span></td></tr>`;
      }).join('')}</tbody></table></div>
    <p class="legend small muted"><span class="off m2">↗</span> your best hit on them · <span class="def m2">↙</span> their best hit on you · * no moves chosen yet, so STAB type is assumed. <b>Answered</b> means someone hits it super-effectively without taking super-effective damage back.</p>
  </div>`;
}

/* Coverage tab */
function renderCoverage() {
  const g = game();
  const members = team().map(t => ({ ...t, info: mon(t.p), types: typesAt(mon(t.p), g.gen) }));
  if (!members.length) return `<p class="empty">Add Pokémon to see your team's type coverage.</p>`;
  const types = typesForGen(g.gen);
  const def = types.map(atk => {
    const effs = members.map(m => effectiveness(atk, m.types, g.gen));
    return { atk, effs, weak: effs.filter(e => e > 1).length, resist: effs.filter(e => e < 1).length };
  });
  const off = types.map(dt => {
    let best = 0, who = [];
    for (const m of members) {
      const atk = bestAttack(m.types, m.moves || [], [dt], g.gen);
      if (atk.eff > best) { best = atk.eff; who = [m.info.name]; } else if (atk.eff === best) who.push(m.info.name);
    }
    return { dt, best, who };
  });
  const se = off.filter(o => o.best >= 2).length;
  return `
    <section class="panel">
      <div class="panel-head"><h3>Defensive chart</h3><span class="muted small">How much damage each attacking type does to each member</span></div>
      <div class="table-wrap"><table class="matrix defchart">
        <thead><tr><th>Attack</th>${members.map(m => `<th class="mem">${sprite(m.p, 40)}<span>${esc(m.info.name)}</span></th>`).join('')}<th class="r">Weak</th><th class="r">Resist</th></tr></thead>
        <tbody>${def.map(r => `<tr><th scope="row">${typeChip(r.atk, true)}</th>
          ${r.effs.map(e => `<td class="cell"><span class="def ${multClass(e)}">${e === 1 ? '' : multLabel(e)}</span></td>`).join('')}
          <td class="num r ${r.weak >= 3 ? 'hot' : ''}">${r.weak || ''}</td><td class="num r">${r.resist || ''}</td></tr>`).join('')}</tbody></table></div>
    </section>
    <section class="panel">
      <div class="panel-head"><h3>Offensive coverage</h3><span class="muted small">${se} of ${types.length} types hit super-effectively</span></div>
      <ul class="cov-grid">${off.map(o => `<li class="${multClass(o.best)}">${typeChip(o.dt, true)}<span class="num">${multLabel(o.best)}</span><span class="small muted">${o.best >= 2 ? esc(o.who.join(', ')) : o.best < 1 ? 'Resisted by all' : 'Neutral'}</span></li>`).join('')}</ul>
    </section>`;
}

/* ---------- actions ---------- */
function addToTeam(pid) {
  const t = team();
  if (t.length >= 6) return toast('Your team is full. Remove a member first.');
  const g = game();
  // Start with the four most recent level-up damaging moves as a sensible default.
  const lvl = (g.pokemon[pid]?.l || []).filter(e => e[1] === 'L' && moveInfo(e[0])?.cls !== 'status');
  const moves = lvl.slice(-4).map(e => e[0]);
  t.push({ p: Number(pid), moves });
  state.slot = t.length - 1;
  teamChanged();
  renderTeam(); renderTabs(); renderWorkspace();
  toast(`${displayName(mon(pid))} joined your team`);
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

function teamText() {
  const g = game();
  return team().map(m => {
    const p = mon(m.p);
    return [displayName(p), ...(m.moves || []).map(id => '- ' + (moveInfo(id)?.name || ''))].join('\n');
  }).join('\n\n') + `\n\n(${g.name})`;
}

function handleClick(e) {
  const el = e.target.closest('[data-action]');
  // Clicking anywhere outside an open move picker closes it.
  if (state.picker && !e.target.closest('.picker') && el?.dataset.action !== 'open-picker') closePicker(!el);
  if (!el) return;
  const a = el.dataset.action;
  const t = team();
  if (a === 'open-picker') { openPicker(Number(el.dataset.k)); return; }
  if (a === 'pick-move') { pickMove(Number(el.dataset.m)); return; }
  if (a === 'quick-move') {
    state.slot = Number(el.dataset.i); state.tab = 'member';
    renderTeam(); renderTabs();
    openPicker(Math.min(Number(el.dataset.k), (t[state.slot].moves || []).length));
    return;
  }
  if (a === 'tab') { state.picker = null; state.tab = el.dataset.tab; renderTabs(); renderWorkspace(); }
  else if (a === 'add') { if (el.getAttribute('aria-disabled') !== 'true') addToTeam(el.dataset.p); else toast('Your team is full. Remove a member first.'); }
  else if (a === 'add-slot') { state.tab = 'dex'; renderTabs(); renderWorkspace(); $('#dex-q')?.focus(); }
  else if (a === 'select-slot') {
    if (e.target.closest('.remove')) return;
    state.slot = Number(el.dataset.i); state.tab = 'member'; state.picker = null; renderTeam(); renderTabs(); renderWorkspace();
  }
  else if (a === 'remove') {
    const i = Number(el.dataset.i);
    const name = displayName(mon(t[i].p));
    t.splice(i, 1);
    state.slot = Math.max(0, Math.min(state.slot, t.length - 1));
    teamChanged(); renderAll(); toast(`Removed ${name}`);
  }
  else if (a === 'move') {
    const m = t[state.slot];
    if (m && (m.moves ||= []).length < 4) { m.moves.push(Number(el.dataset.m)); teamChanged(); renderTeam(); renderWorkspace(); }
  }
  else if (a === 'unmove') {
    const m = t[state.slot];
    if (m) { m.moves = m.moves.filter(id => id !== Number(el.dataset.m)); teamChanged(); renderTeam(); renderWorkspace(); }
  }
  else if (a === 'enc-more') {
    const k = Number(el.dataset.k);
    state.encOpen ||= new Set();
    state.encOpen.has(k) ? state.encOpen.delete(k) : state.encOpen.add(k);
    renderWorkspace();
  }
  else if (a === 'learn-filter') { state.learnFilter = el.dataset.f; renderWorkspace(); }
  else if (a === 'battle-filter') { state.battleFilter = el.dataset.f; renderWorkspace(); }
  else if (a === 'toggle-battle') { state.openBattle = state.openBattle === el.dataset.k ? null : el.dataset.k; renderWorkspace(); }
  else if (a === 'jump') {
    state.tab = 'dex'; state.dex.q = mon(el.dataset.p).name; state.dex.type = ''; state.dex.regional = false;
    renderTabs(); renderWorkspace(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  else if (a === 'clear') {
    if (!t.length) return;
    if (el.dataset.confirm !== 'yes') {
      el.dataset.confirm = 'yes'; el.textContent = 'Click again to clear';
      setTimeout(() => { el.dataset.confirm = ''; el.textContent = 'Clear team'; }, 3000);
      return;
    }
    t.splice(0); state.slot = 0; teamChanged(); renderAll();
    el.dataset.confirm = ''; el.textContent = 'Clear team';
  }
  else if (a === 'copy') {
    const text = teamText();
    navigator.clipboard?.writeText(text).then(() => toast('Team copied as text'), () => showCopyFallback(text))
      ?? showCopyFallback(text);
  }
  else if (a === 'team-new') {
    const nt = blankTeam(uniqueTeamName('New team'));
    gameLib().teams.push(nt);
    switchTeam(nt.id);
    window.cloud?.queue(nt, state.game);
    state.tab = 'dex'; renderTabs(); renderWorkspace();
    toast('Started a new team');
  }
  else if (a === 'team-dup') {
    const src = activeTeam();
    const nt = { ...blankTeam(uniqueTeamName(`${src.name} copy`)), members: JSON.parse(JSON.stringify(src.members)) };
    gameLib().teams.push(nt);
    switchTeam(nt.id);
    window.cloud?.queue(nt, state.game);
    toast(`Duplicated as “${nt.name}”`);
  }
  else if (a === 'team-delete') {
    if (el.dataset.confirm !== 'yes') {
      el.dataset.confirm = 'yes'; el.textContent = 'Click again to delete';
      setTimeout(() => { if (el.isConnected) { el.dataset.confirm = ''; el.textContent = 'Delete'; } }, 3000);
      return;
    }
    const gl = gameLib();
    const gone = activeTeam();
    gl.teams = gl.teams.filter(x => x.id !== gone.id);
    window.cloud?.remove(gone);
    switchTeam(gameLib().active);
    toast(`Deleted “${gone.name}”`);
  }
  else if (a === 'team-menu') {
    state.teamMenu = el.dataset.m || null;
    renderTeamBar();
    if (state.teamMenu === 'rename') { const i = $('#team-name'); i.focus(); i.select(); }
  }
  else if (a === 'share' || a === 'unshare') {
    const st = activeTeam();
    st.isPublic = a === 'share';
    teamChanged(st);
    window.cloud?.flush();
    renderTeamBar();
    toast(st.isPublic ? 'Share link created' : 'Sharing turned off. The old link no longer works.');
  }
  else if (a === 'copy-link') {
    const input = $('#share-link');
    navigator.clipboard?.writeText(input.value).then(() => toast('Link copied'), () => { input.select(); toast('Press Ctrl+C to copy'); })
      ?? input.select();
  }
  else if (a === 'sign-in') window.cloud?.signIn();
  else if (a === 'sign-out') window.cloud?.signOut();
}

function handleSubmit(e) {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  if (form.dataset.form === 'rename') {
    const name = $('#team-name').value.trim().slice(0, 60);
    if (!name) return;
    const t = activeTeam();
    t.name = name;
    state.teamMenu = null;
    teamChanged(t);
    renderTeamBar();
    toast(`Renamed to “${name}”`);
  }
}
function showCopyFallback(text) {
  const box = $('#copy-fallback');
  box.hidden = false;
  box.querySelector('textarea').value = text;
  box.querySelector('textarea').select();
}

let qTimer;
function handleInput(e) {
  const id = e.target.id;
  if (id === 'move-search' && state.picker) {
    state.picker.q = e.target.value;
    state.picker.hi = 0;
    refreshPickerList();
  } else if (id === 'dex-q') {
    state.dex.q = e.target.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      const pos = e.target.selectionStart;
      renderWorkspace(); save();
      const q = $('#dex-q'); q.focus(); q.setSelectionRange(pos, pos);
    }, 120);
  }
}
function handleChange(e) {
  const id = e.target.id;
  if (id === 'game') selectGame(e.target.value);
  else if (id === 'team-select') switchTeam(e.target.value);
  else if (id === 'version') { state.version = Number(e.target.value); save(); renderTeam(); renderWorkspace(); }
  else if (id === 'dex-type') { state.dex.type = e.target.value; save(); renderWorkspace(); }
  else if (id === 'dex-sort') { state.dex.sort = e.target.value; save(); renderWorkspace(); }
  else if (id === 'dex-regional') { state.dex.regional = e.target.checked; save(); renderWorkspace(); }
  else if (id === 'dex-wild') { state.dex.wild = e.target.checked; save(); renderWorkspace(); }
}

/* ---------- accounts (called by cloud.js) ---------- */
// Swap to a different library: on sign-in, sign-out, or when the account's teams arrive.
function useLibrary(owner, lib) {
  state.owner = owner;
  state.lib = lib;
  state.slot = 0; state.picker = null; state.teamMenu = null;
  if (data.games[state.game]) { seedExample(state.game); save(); renderAll(); }
}

// ?team=<id> opens a shared team: the owner just switches to it, anyone else gets a copy.
async function openSharedTeam() {
  const id = new URLSearchParams(location.search).get('team');
  if (!id) return;
  history.replaceState(null, '', location.pathname + location.hash);
  const row = await window.cloud?.fetchShared(id);
  if (!row) return toast('That share link is invalid or sharing was turned off.');
  if (!data.core.games.some(g => g.key === row.game)) return toast('That team is for a game this site doesn’t cover.');
  await selectGame(row.game);
  const gl = gameLib(row.game);
  const own = gl.teams.find(t => t.id === row.id);
  if (own) return switchTeam(own.id);
  const copy = { ...blankTeam(uniqueTeamName(`${row.name} (shared)`, row.game)), members: row.members };
  gl.teams.push(copy);
  switchTeam(copy.id);
  window.cloud?.queue(copy, row.game);
  toast(`Copied “${row.name}” into your teams`);
}

async function init() {
  load();
  document.addEventListener('click', handleClick);
  document.addEventListener('submit', handleSubmit);
  document.addEventListener('input', handleInput);
  document.addEventListener('change', handleChange);
  document.addEventListener('keydown', e => {
    if (e.target.id === 'move-search') return handlePickerKey(e);
    if (e.key === 'Escape' && state.picker) return closePicker();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.slot[role="button"]')) { e.preventDefault(); e.target.click(); }
  });
  try {
    [data.core, data.sprites] = await Promise.all([getJSON('data/core.json'), getJSON('data/sprites.json').catch(() => null)]);
  } catch (err) {
    $('#workspace').innerHTML = `<p class="empty">${esc(err.message)}. Open this page through a local web server (see README) so it can read the data folder.</p>`;
    return;
  }
  if (!data.core.games.some(g => g.key === state.game)) state.game = DEFAULT_GAME;
  await selectGame(state.game);
  await window.cloud?.start();
  await openSharedTeam();
}
init();
