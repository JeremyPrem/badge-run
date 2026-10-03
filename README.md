# Badge Run

A Pokémon team planner for 20 main-series games, from Red & Blue to Scarlet & Violet.

- **Pokédex**: filter by game, version, regional dex, type, and "catchable in the wild".
- **Moves & locations**: choose up to 4 moves from that game's real learnset (level-up, TM/HM/TR, tutor, egg), and see where to catch the Pokémon (or its pre-evolution).
  Click any move slot (in the Moves tab or on a team card) to open a searchable dropdown: type a name, a type (`fire`), a category (`status`) or `stab`; use ↑/↓ and Enter to pick, Esc to close. With no search, the strongest same-type attacks are listed first.
- **Battles**: every gym leader / trial, Elite Four, champion, key rival and villain battle, with real teams and movesets. Each battle gets a type-matchup grid (your best hit on each opponent, and their best hit on you) and an overall verdict.
- **Coverage**: defensive chart and offensive coverage for the whole team.

Teams are saved in the browser per game.

## Run locally

The page loads JSON with `fetch`, so it needs a web server (opening `index.html` as a file won't work). From this folder:

```bash
python -m http.server 5173
```

Then open http://localhost:5173.

## Hosting

The site is fully static, with relative paths, so it runs from any subfolder. It's published with GitHub Pages straight from the `main` branch root; `.nojekyll` stops Pages from running Jekyll over it. The built `data/` folder is committed so Pages can serve it as-is.

## Data pipeline

| Step | Command | Output |
|---|---|---|
| PokeAPI CSVs | `python tools/fetch_csv.py` | `tools/csv/*.csv` (not committed) |
| Boss teams | hand-compiled JSON in `data-src/bosses/<game>.json`; check with `python tools/validate_bosses.py data-src/bosses/*.json` | |
| Build game data | `python tools/build_data.py` | `data/core.json`, `data/games/*.json` |
| Sprite sheet | `python tools/build_sprites.py` (needs Pillow) | `data/sprites.png`, `data/sprites.json` |
| Smoke test | `node tools/smoke_test.js` | renders every tab and battle for every game |
| Artifact page | `python tools/make_artifact.py` | `artifact.html` |

## Known gaps

- PokeAPI has no encounter data for Brilliant Diamond & Shining Pearl or Scarlet & Violet, and only partial data for X & Y and Omega Ruby & Alpha Sapphire.
- Matchups are type-based. Levels, stats, abilities (e.g. Levitate) and held items aren't simulated.
- Boss teams were compiled from the pret decompilations (Gen 1–2, FRLG, HGSS), Bulbapedia (Gen 3–4, Kalos, Alola, Let's Go) and Serebii (Unova, Galar, Paldea). Team Star Tera types and some Gen 1 movesets were inferred rather than copied.
