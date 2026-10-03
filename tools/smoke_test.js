// Headless smoke test: loads every game, seeds a team, renders every tab and battle matrix.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const el = () => ({ innerHTML: '', textContent: '', hidden: false, value: '', options: [], classList: { add() {}, remove() {} },
  setAttribute() {}, querySelector: () => el(), focus() {}, setSelectionRange() {}, dataset: {} });
const els = {};
global.document = { querySelector: s => (els[s] ||= el()), querySelectorAll: () => [], addEventListener() {} };
global.window = { scrollTo() {}, addEventListener() {} };
global.location = { search: '', pathname: '/', origin: 'http://localhost', hash: '', href: 'http://localhost/' };
global.history = { replaceState() {} };
global.localStorage = { getItem: () => null, setItem() {} };
global.navigator = {};
global.fetch = async url => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, url), 'utf8')) });
const src = fs.readFileSync(path.join(ROOT, 'src/types.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8').replace(/\ninit\(\);\s*$/, '\n');
eval(src + `
(async () => {
  await init();
  let errors = 0;
  for (const g of data.core.games) {
    await selectGame(g.key);
    const gm = game();
    // Team: first six fully-evolved-looking picks with the most BST from the regional dex.
    if (!team().length) {
      const picks = Object.keys(gm.pokemon).filter(pid => mon(pid) && !mon(pid).battleOnly && gm.pokemon[pid].d)
        .sort((a, b) => bst(mon(b)) - bst(mon(a))).slice(10, 16);
      picks.forEach(pid => addToTeam(pid));
    }
    for (const tab of ['dex', 'member', 'battles', 'coverage']) {
      state.tab = tab;
      try { renderWorkspace(); } catch (e) { errors++; console.log('ERR', g.key, tab, e.message); }
    }
    const verdicts = {};
    for (const b of gm.bosses) {
      try {
        const a = analyzeBattle(b); verdicts[a.verdict] = (verdicts[a.verdict] || 0) + 1;
        renderMatrix(b, a);
        for (const m of b.team) if (!mon(m.p)) { errors++; console.log('missing mon', g.key, b.name, m.p); }
        for (const m of b.team) for (const mv of m.moves || []) if (!gm.moves[mv]) { errors++; console.log('missing move', g.key, b.name, mv); }
      } catch (e) { errors++; console.log('ERR battle', g.key, b.name, e.message); }
    }
    console.log(g.key.padEnd(34), 'team', team().map(t => mon(t.p).name).join(',').slice(0, 70), JSON.stringify(verdicts));
  }
  console.log(errors ? errors + ' errors' : 'ALL OK');
})();`);
