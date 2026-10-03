// Type effectiveness by generation. Chart rows are attacking types, values are multipliers
// against each defending type (omitted = 1).
const TYPES = ['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
  'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'];

const CHART_MODERN = {
  normal: { rock: .5, ghost: 0, steel: .5 },
  fire: { fire: .5, water: .5, grass: 2, ice: 2, bug: 2, rock: .5, dragon: .5, steel: 2 },
  water: { fire: 2, water: .5, grass: .5, ground: 2, rock: 2, dragon: .5 },
  electric: { water: 2, electric: .5, grass: .5, ground: 0, flying: 2, dragon: .5 },
  grass: { fire: .5, water: 2, grass: .5, poison: .5, ground: 2, flying: .5, bug: .5, rock: 2, dragon: .5, steel: .5 },
  ice: { fire: .5, water: .5, grass: 2, ice: .5, ground: 2, flying: 2, dragon: 2, steel: .5 },
  fighting: { normal: 2, ice: 2, poison: .5, flying: .5, psychic: .5, bug: .5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: .5 },
  poison: { grass: 2, poison: .5, ground: .5, rock: .5, ghost: .5, steel: 0, fairy: 2 },
  ground: { fire: 2, electric: 2, grass: .5, poison: 2, flying: 0, bug: .5, rock: 2, steel: 2 },
  flying: { electric: .5, grass: 2, fighting: 2, bug: 2, rock: .5, steel: .5 },
  psychic: { fighting: 2, poison: 2, psychic: .5, dark: 0, steel: .5 },
  bug: { fire: .5, grass: 2, fighting: .5, poison: .5, flying: .5, psychic: 2, ghost: .5, dark: 2, steel: .5, fairy: .5 },
  rock: { fire: 2, ice: 2, fighting: .5, ground: .5, flying: 2, bug: 2, steel: .5 },
  ghost: { normal: 0, psychic: 2, ghost: 2, dark: .5 },
  dragon: { dragon: 2, steel: .5, fairy: 0 },
  dark: { fighting: .5, psychic: 2, ghost: 2, dark: .5, fairy: .5 },
  steel: { fire: .5, water: .5, electric: .5, ice: 2, rock: 2, steel: .5, fairy: 2 },
  fairy: { fire: .5, fighting: 2, poison: .5, dragon: 2, dark: 2, steel: .5 },
};

function buildChart(gen) {
  const chart = JSON.parse(JSON.stringify(CHART_MODERN));
  if (gen < 6) {
    delete chart.fairy;
    for (const row of Object.values(chart)) delete row.fairy;
    // Steel resisted Ghost and Dark before Gen 6.
    chart.ghost.steel = .5;
    chart.dark.steel = .5;
  }
  if (gen === 1) {
    delete chart.dark; delete chart.steel;
    for (const row of Object.values(chart)) { delete row.dark; delete row.steel; }
    chart.ghost.psychic = 0;      // the famous Gen 1 bug
    chart.bug.poison = 2;
    chart.poison.bug = 2;
    delete chart.ice.fire;        // Ice was neutral against Fire
  }
  return chart;
}

const CHARTS = {};
function typesForGen(gen) {
  if (gen === 1) return TYPES.filter(t => !['dark', 'steel', 'fairy'].includes(t));
  if (gen < 6) return TYPES.filter(t => t !== 'fairy');
  return TYPES;
}

function effectiveness(atk, defTypes, gen) {
  const chart = CHARTS[gen] || (CHARTS[gen] = buildChart(gen));
  const row = chart[atk];
  if (!row) return 1;
  let m = 1;
  for (const d of defTypes) m *= (row[d] ?? 1);
  return m;
}

const TYPE_COLORS = {
  normal: '#9fa19f', fire: '#e8622d', water: '#3d8ee6', electric: '#f2c12e', grass: '#4fa846',
  ice: '#58c8d8', fighting: '#d0583a', poison: '#9a4fc0', ground: '#b98b45', flying: '#7fa4e0',
  psychic: '#e9567c', bug: '#93a523', rock: '#b0a066', ghost: '#6b5a9c', dragon: '#5a62d8',
  dark: '#5a4b45', steel: '#6aa1b5', fairy: '#e690e0',
};
