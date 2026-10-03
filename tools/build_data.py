"""Build compact JSON data for the team builder from PokeAPI CSV exports.

Inputs:  tools/csv/*.csv (PokeAPI data/v2/csv) and data-src/bosses/*.json
Outputs: data/core.json and data/games/<version-group>.json

Run: python tools/build_data.py
"""
import csv, json, os, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV = os.path.join(ROOT, 'tools', 'csv')
OUT = os.path.join(ROOT, 'data')
BOSSES = os.path.join(ROOT, 'data-src', 'bosses')
EN = '9'

# Main-series games the site supports, in release order.
GAMES = [
    'red-blue', 'yellow', 'gold-silver', 'crystal', 'ruby-sapphire', 'emerald',
    'firered-leafgreen', 'diamond-pearl', 'platinum', 'heartgold-soulsilver',
    'black-white', 'black-2-white-2', 'x-y', 'omega-ruby-alpha-sapphire',
    'sun-moon', 'ultra-sun-ultra-moon', 'lets-go-pikachu-lets-go-eevee',
    'sword-shield', 'brilliant-diamond-shining-pearl', 'scarlet-violet',
]
GAME_NAMES = {
    'red-blue': 'Red & Blue', 'yellow': 'Yellow', 'gold-silver': 'Gold & Silver',
    'crystal': 'Crystal', 'ruby-sapphire': 'Ruby & Sapphire', 'emerald': 'Emerald',
    'firered-leafgreen': 'FireRed & LeafGreen', 'diamond-pearl': 'Diamond & Pearl',
    'platinum': 'Platinum', 'heartgold-soulsilver': 'HeartGold & SoulSilver',
    'black-white': 'Black & White', 'black-2-white-2': 'Black 2 & White 2',
    'x-y': 'X & Y', 'omega-ruby-alpha-sapphire': 'Omega Ruby & Alpha Sapphire',
    'sun-moon': 'Sun & Moon', 'ultra-sun-ultra-moon': 'Ultra Sun & Ultra Moon',
    'lets-go-pikachu-lets-go-eevee': "Let's Go, Pikachu! & Eevee!",
    'sword-shield': 'Sword & Shield', 'brilliant-diamond-shining-pearl': 'Brilliant Diamond & Shining Pearl',
    'scarlet-violet': 'Scarlet & Violet',
}
REGION = {
    'red-blue': 'Kanto', 'yellow': 'Kanto', 'gold-silver': 'Johto', 'crystal': 'Johto',
    'ruby-sapphire': 'Hoenn', 'emerald': 'Hoenn', 'firered-leafgreen': 'Kanto',
    'diamond-pearl': 'Sinnoh', 'platinum': 'Sinnoh', 'heartgold-soulsilver': 'Johto',
    'black-white': 'Unova', 'black-2-white-2': 'Unova', 'x-y': 'Kalos',
    'omega-ruby-alpha-sapphire': 'Hoenn', 'sun-moon': 'Alola', 'ultra-sun-ultra-moon': 'Alola',
    'lets-go-pikachu-lets-go-eevee': 'Kanto', 'sword-shield': 'Galar',
    'brilliant-diamond-shining-pearl': 'Sinnoh', 'scarlet-violet': 'Paldea',
}
# DLC version groups whose dexes/encounters fold into the base game.
DLC = {'sword-shield': ['the-isle-of-armor', 'the-crown-tundra'],
       'scarlet-violet': ['the-teal-mask', 'the-indigo-disk']}

METHOD_SHORT = {
    'walk': 'Grass/Cave', 'old-rod': 'Old Rod', 'good-rod': 'Good Rod', 'super-rod': 'Super Rod',
    'surf': 'Surfing', 'rock-smash': 'Rock Smash', 'headbutt': 'Headbutt', 'dark-grass': 'Dark grass',
    'grass-spots': 'Rustling grass', 'cave-spots': 'Dust cloud', 'bridge-spots': 'Bridge shadow',
    'super-rod-spots': 'Fishing (ripples)', 'surf-spots': 'Surfing (ripples)', 'yellow-flowers': 'Yellow flowers',
    'purple-flowers': 'Purple flowers', 'red-flowers': 'Red flowers', 'rough-terrain': 'Rough terrain',
    'gift': 'Gift', 'gift-egg': 'Gift egg', 'only-one': 'Static', 'pokeflute': 'Poké Flute',
    'headbutt-low': 'Headbutt', 'headbutt-normal': 'Headbutt', 'headbutt-high': 'Headbutt',
    'squirt-bottle': 'Squirt Bottle', 'wailmer-pail': 'Wailmer Pail', 'seaweed': 'Diving',
    'npc-trade': 'Trade', 'roaming-grass': 'Roaming', 'roaming-water': 'Roaming (water)',
    'devon-scope': 'Devon Scope', 'feebas-tile-fishing': 'Fishing (Feebas tiles)', 'island-scan': 'Island Scan',
    'sos': 'SOS battle', 'bubbling-spots': 'Fishing (bubbles)', 'berry-trees': 'Berry tree',
    'sos-from-bubbling-spot': 'SOS (bubbles)', 'overworld': 'Overworld', 'overworld-water': 'Overworld (water)',
    'overworld-flying': 'Overworld (sky)', 'overworld-special': 'Rare spawn', 'overworld-flying-special': 'Rare spawn (sky)',
    'overworld-water-special': 'Rare spawn (water)', 'horde': 'Horde', 'hidden-grotto': 'Hidden Grotto',
    'honey-tree': 'Honey tree', 'overworld-dirt': 'Overworld (dirt)', 'wanderer': 'Wanderer (fixed)',
    'wanderer-water': 'Wanderer (water)', 'chase-water': 'Chases in water', 'dynamax-adventure': 'Dynamax Adventure',
    'max-raid': 'Max Raid', 'trash-can-ambush': 'Trash can', 'rustling-bush-ambush': 'Rustling bush',
    'ceiling-ambush': 'Ambush (ceiling)', 'ground-ambush': 'Ambush (ground)', 'sky-ambush': 'Ambush (sky)',
}

def rows(name):
    with open(os.path.join(CSV, name + '.csv'), encoding='utf-8') as f:
        return list(csv.DictReader(f))

def en_names(name, key, field='name'):
    return {r[key]: r[field] for r in rows(name) if r['local_language_id'] == EN}

def summarize_conditions(conds):
    """Collapse condition sets so they stay short (e.g. many weathers -> 'Varies by weather')."""
    weather = sorted(c for c in conds if 'weather' in c.lower() or c in ('During a thunderstorm', 'During a sandstorm', 'During a blizzard', 'During heavy fog', 'During snowstorm', 'During intense sun', 'During snowfall'))
    rest = sorted(c for c in conds if c not in weather)
    if len(weather) >= 3:
        rest.append('Varies by weather')
    else:
        rest.extend(weather)
    # 'Before X' + 'After X' together means the condition doesn't matter.
    for before, after in (('Before entering the Hall of Fame', 'Enter the Hall of Fame'),
                          ('Before entering the Hall of Fame', 'After entering the Hall of Fame')):
        if before in rest and after in rest:
            rest.remove(before); rest.remove(after)
    if any(c.startswith(('Start a max raid', 'Start max raid')) for c in rest):
        rest = [c for c in rest if not c.startswith(('Start a max raid', 'Start max raid'))]
    rest = ['After the Hall of Fame' if c in ('Enter the Hall of Fame', 'After entering the Hall of Fame') else c for c in rest]
    times = [c for c in rest if c in ('In the morning', 'During the day', 'At night')]
    if len(times) == 3:
        rest = [c for c in rest if c not in times]
    return rest

def main():
    os.makedirs(os.path.join(OUT, 'games'), exist_ok=True)
    vg_rows = {r['identifier']: r for r in rows('version_groups')}
    vg_by_id = {r['id']: r for r in vg_rows.values()}
    versions = rows('versions')
    version_names = en_names('version_names', 'version_id')
    types = {r['id']: r['identifier'] for r in rows('types') if int(r['id']) < 10000}
    gen_of_vg = {r['id']: int(r['generation_id']) for r in vg_rows.values()}
    order_of_vg = {r['id']: int(r['order']) for r in vg_rows.values()}

    # ---- Pokemon ----
    species = {r['id']: r for r in rows('pokemon_species')}
    species_names = en_names('pokemon_species_names', 'pokemon_species_id')
    form_rows = rows('pokemon_forms')
    forms_by_pokemon = collections.defaultdict(list)
    for r in form_rows:
        forms_by_pokemon[r['pokemon_id']].append(r)
    ptypes = collections.defaultdict(list)
    for r in sorted(rows('pokemon_types'), key=lambda r: int(r['slot'])):
        ptypes[r['pokemon_id']].append(types[r['type_id']])
    past = collections.defaultdict(lambda: collections.defaultdict(list))
    for r in sorted(rows('pokemon_types_past'), key=lambda r: int(r['slot'])):
        past[r['pokemon_id']][int(r['generation_id'])].append(types[r['type_id']])
    stats = collections.defaultdict(lambda: [0] * 6)
    for r in rows('pokemon_stats'):
        sid = int(r['stat_id'])
        if 1 <= sid <= 6:
            stats[r['pokemon_id']][sid - 1] = int(r['base_stat'])

    pokemon = {}
    for r in rows('pokemon'):
        sp = species[r['species_id']]
        name = species_names.get(r['species_id'], r['identifier'])
        forms = forms_by_pokemon.get(r['id'], [])
        default_form = next((f for f in forms if f['is_default'] == '1'), forms[0] if forms else None)
        form_label = ''
        if r['is_default'] != '1':
            ident = r['identifier']
            suffix = ident[len(sp['identifier']) + 1:] if ident.startswith(sp['identifier'] + '-') else ident
            form_label = suffix.replace('-', ' ').title()
        battle_only = bool(default_form and default_form['is_battle_only'] == '1')
        is_mega = bool(default_form and default_form['is_mega'] == '1')
        p = {
            'id': int(r['id']), 'key': r['identifier'], 'name': name, 'species': int(r['species_id']),
            'form': form_label, 'types': ptypes[r['id']], 'stats': stats[r['id']],
            'gen': int(sp['generation_id']),
        }
        if sp['evolves_from_species_id']:
            p['from'] = int(sp['evolves_from_species_id'])
        if past.get(r['id']):
            p['pastTypes'] = {str(g): t for g, t in sorted(past[r['id']].items())}
        if battle_only or is_mega:
            p['battleOnly'] = 1
        pokemon[r['id']] = p

    # ---- Moves ----
    move_names = en_names('move_names', 'move_id')
    changelog = collections.defaultdict(list)
    for r in rows('move_changelog'):
        changelog[r['move_id']].append(r)
    moves = {}
    for r in rows('moves'):
        if int(r['id']) >= 10000:
            continue
        m = {
            'key': r['identifier'], 'name': move_names.get(r['id'], r['identifier']),
            'type': types.get(r['type_id'], 'normal'), 'power': int(r['power']) if r['power'] else None,
            'acc': int(r['accuracy']) if r['accuracy'] else None, 'pp': int(r['pp']) if r['pp'] else None,
            'cls': {'1': 'status', '2': 'physical', '3': 'special'}.get(r['damage_class_id'], 'status'),
            'gen': int(r['generation_id']), 'prio': int(r['priority']),
        }
        # Older stats: each changelog row holds the values used *before* that version group.
        hist = []
        for c in changelog.get(r['id'], []):
            ch = {'before': order_of_vg[c['changed_in_version_group_id']]}
            if c['type_id'] in types: ch['type'] = types[c['type_id']]
            if c['power']: ch['power'] = int(c['power'])
            if c['accuracy']: ch['acc'] = int(c['accuracy'])
            if c['pp']: ch['pp'] = int(c['pp'])
            if len(ch) > 1: hist.append(ch)
        if hist:
            m['hist'] = sorted(hist, key=lambda h: h['before'])
        moves[r['id']] = m

    def move_at(mid, vg_order):
        m = moves[mid]
        out = {k: m[k] for k in ('name', 'type', 'power', 'acc', 'pp', 'cls')}
        for field in ('type', 'power', 'acc', 'pp'):
            for h in m.get('hist', []):
                if h['before'] > vg_order and field in h:
                    out[field] = h[field]
                    break
        return out

    # ---- Dexes ----
    dex_vgs = collections.defaultdict(list)
    for r in rows('pokedex_version_groups'):
        dex_vgs[r['version_group_id']].append(r['pokedex_id'])
    dex_names = en_names('pokedex_prose', 'pokedex_id')
    dex_numbers = collections.defaultdict(dict)  # pokedex_id -> species_id -> number
    for r in rows('pokemon_dex_numbers'):
        dex_numbers[r['pokedex_id']][r['species_id']] = int(r['pokedex_number'])

    # ---- Learnsets ----
    method_code = {'1': 'L', '2': 'E', '3': 'T', '4': 'M'}
    learn = collections.defaultdict(lambda: collections.defaultdict(dict))  # vg -> pokemon -> move -> (code, level)
    for r in rows('pokemon_moves'):
        code = method_code.get(r['pokemon_move_method_id'])
        if not code:
            continue
        cur = learn[r['version_group_id']][r['pokemon_id']]
        lvl = int(r['level'] or 0)
        prev = cur.get(r['move_id'])
        rank = 'LMTE'
        if prev is None or rank.index(code) < rank.index(prev[0]) or (code == prev[0] == 'L' and lvl < prev[1]):
            cur[r['move_id']] = (code, lvl)
    machines = collections.defaultdict(dict)  # vg -> move -> "TM24"
    item_names = {}
    for r in rows('machines'):
        machines[r['version_group_id']][r['move_id']] = int(r['machine_number'])

    # ---- Encounters ----
    area_names = en_names('location_area_prose', 'location_area_id')
    loc_names = en_names('location_names', 'location_id')
    areas = {r['id']: r for r in rows('location_areas')}
    slots = {r['id']: r for r in rows('encounter_slots')}
    methods = {r['id']: r['identifier'] for r in rows('encounter_methods')}
    method_prose = en_names('encounter_method_prose', 'encounter_method_id')
    cond_names = en_names('encounter_condition_value_prose', 'encounter_condition_value_id')
    enc_cond = collections.defaultdict(list)
    for r in rows('encounter_condition_value_map'):
        enc_cond[r['encounter_id']].append(cond_names.get(r['encounter_condition_value_id'], ''))
    enc_by_version = collections.defaultdict(list)
    for r in rows('encounters'):
        enc_by_version[r['version_id']].append(r)

    def area_label(area_id):
        a = areas[area_id]
        loc = loc_names.get(a['location_id'], '')
        sub = a['identifier'].replace('-', ' ').strip()
        if not loc:
            return area_names.get(area_id, '') or 'Unknown area'
        if sub and sub.lower() not in ('area', 'main', loc.lower()):
            return f'{loc} ({sub[0].upper() + sub[1:]})'
        return loc

    used_pokemon = set()
    games_meta = []
    for vg_key in GAMES:
        vg = vg_rows[vg_key]
        vg_ids = [vg['id']] + [vg_rows[d]['id'] for d in DLC.get(vg_key, [])]
        gen = int(vg['generation_id'])
        vorder = int(vg['order'])
        vers = [v for v in versions if v['version_group_id'] in vg_ids]
        main_vers = [v for v in vers if v['version_group_id'] == vg['id']]
        version_index = {}
        for v in vers:
            # DLC versions map onto the matching base version (e.g. the-isle-of-armor-sword -> sword).
            base = next((mv for mv in main_vers if v['identifier'].endswith(mv['identifier'])), None)
            version_index[v['id']] = main_vers.index(base) if base else 0

        # Dexes (regional + DLC), in order.
        dexes = []
        for vid in vg_ids:
            for d in dex_vgs.get(vid, []):
                if d not in [x['id'] for x in dexes]:
                    dexes.append({'id': d, 'name': dex_names.get(d, d)})

        # Learnsets: base game only (DLC version groups add little).
        ls = learn.get(vg['id'], {})
        game_pokemon = {}
        for pid, mv in ls.items():
            if pid not in pokemon:
                continue
            entries = sorted(([int(m), c, l] for m, (c, l) in mv.items()),
                             key=lambda e: ('LMTE'.index(e[1]), e[2], moves[str(e[0])]['name']))
            game_pokemon[pid] = entries

        # Regional dex numbers per pokemon (species-level).
        dex_no = {}
        for i, d in enumerate(dexes):
            for pid in game_pokemon:
                sp = str(pokemon[pid]['species'])
                if sp in dex_numbers[d['id']]:
                    dex_no.setdefault(pid, [None] * len(dexes))[i] = dex_numbers[d['id']][sp]

        # Encounters per pokemon.
        enc = collections.defaultdict(dict)  # pid -> key -> record
        for v in vers:
            vi = version_index[v['id']]
            for r in enc_by_version.get(v['id'], []):
                slot = slots[r['encounter_slot_id']]
                mkey = methods[slot['encounter_method_id']]
                method = METHOD_SHORT.get(mkey) or method_prose.get(slot['encounter_method_id'], mkey)
                conds = sorted({c for c in enc_cond.get(r['id'], []) if c})
                label = area_label(r['location_area_id'])
                k = (label, method)
                rec = enc[r['pokemon_id']].get(k)
                rarity = int(slot['rarity'] or 0)
                lo, hi = int(r['min_level']), int(r['max_level'])
                if rec is None:
                    rec = {'loc': label, 'method': method, 'min': lo, 'max': hi, 'v': 0, 'rate': {}, 'cond': set()}
                    enc[r['pokemon_id']][k] = rec
                rec['cond'].update(conds)
                rec['min'] = min(rec['min'], lo)
                rec['max'] = max(rec['max'], hi)
                rec['v'] |= 1 << vi
                rec['rate'][vi] = rec['rate'].get(vi, 0) + rarity
        encounters = {}
        for pid, recs in enc.items():
            if pid not in pokemon:
                continue
            out = []
            for rec in recs.values():
                rate = max(rec['rate'].values()) if rec['rate'] else 0
                item = [rec['loc'], rec['method'], rec['min'], rec['max'], rec['v'], min(rate, 100)]
                conds = summarize_conditions(rec['cond'])
                if conds:
                    item.append(conds)
                out.append(item)
            out.sort(key=lambda e: (e[2], e[0]))
            encounters[pid] = out
            game_pokemon.setdefault(pid, [])

        # Moves used in this game, with stats as of this game.
        move_ids = {e[0] for es in game_pokemon.values() for e in es}

        # Bosses
        bosses = []
        bpath = os.path.join(BOSSES, vg_key + '.json')
        key_to_pid = {p['key']: pid for pid, p in pokemon.items()}
        move_key_to_id = {m['key']: mid for mid, m in moves.items()}
        if os.path.exists(bpath):
            with open(bpath, encoding='utf-8') as f:
                bdata = json.load(f)
            for b in bdata.get('battles', []):
                team = []
                for m in b.get('team', []):
                    pid = key_to_pid.get(m['pokemon'])
                    if not pid:
                        print(f'  ! {vg_key}: unknown boss pokemon {m["pokemon"]}')
                        continue
                    used_pokemon.add(pid)
                    mm = [int(move_key_to_id[x]) for x in m.get('moves', []) if x in move_key_to_id]
                    move_ids.update(mm)
                    t = {'p': int(pid), 'lv': m.get('level')}
                    if mm: t['moves'] = mm
                    for opt in ('item', 'tera', 'ace', 'dynamax', 'gmax'):
                        if m.get(opt): t[opt] = m[opt]
                    # Mega Evolution: explicit flag, or holding a Mega Stone that matches a mega form.
                    item = (m.get('item') or '').lower()
                    if m.get('mega') or (item.endswith(('ite', 'ite x', 'ite y')) and item not in ('eviolite',)):
                        suffix = '-mega-x' if item.endswith(' x') else '-mega-y' if item.endswith(' y') else '-mega'
                        mp = key_to_pid.get(m['pokemon'] + suffix) or key_to_pid.get(m['pokemon'] + '-mega')
                        if mp:
                            t['mega'] = int(mp)
                            used_pokemon.add(mp)
                    team.append(t)
                bb = {k: b[k] for k in ('id', 'name', 'title', 'category', 'type', 'badge', 'levelCap', 'variant', 'note') if b.get(k) is not None}
                if b.get('versions'):
                    bb['v'] = sum(1 << i for i, mv in enumerate(main_vers) if mv['identifier'] in b['versions'])
                bb['team'] = team
                bosses.append(bb)

        game_moves = {mid: move_at(str(mid), vorder) for mid in sorted(move_ids)}
        tm = {mid: n for mid, n in ((int(k), v) for k, v in machines.get(vg['id'], {}).items()) if mid in move_ids}
        used_pokemon.update(game_pokemon)

        data = {
            'key': vg_key, 'name': GAME_NAMES[vg_key], 'gen': gen, 'region': REGION[vg_key],
            'versions': [{'key': v['identifier'], 'name': version_names.get(v['id'], v['identifier'])} for v in main_vers],
            'dexes': [d['name'] for d in dexes],
            'pokemon': {str(pid): {'l': ls_, **({'d': dex_no[pid]} if pid in dex_no else {}), **({'e': encounters[pid]} if pid in encounters else {})}
                        for pid, ls_ in sorted(game_pokemon.items(), key=lambda x: int(x[0]))},
            'moves': {str(k): v for k, v in game_moves.items()},
            'tm': {str(k): v for k, v in tm.items()},
            'bosses': bosses,
            'hasEncounters': bool(encounters),
        }
        with open(os.path.join(OUT, 'games', vg_key + '.json'), 'w', encoding='utf-8') as f:
            json.dump(data, f, separators=(',', ':'), ensure_ascii=False)
        games_meta.append({'key': vg_key, 'name': GAME_NAMES[vg_key], 'gen': gen, 'region': REGION[vg_key],
                           'versions': data['versions'], 'bosses': len(bosses),
                           'hasEncounters': data['hasEncounters']})
        print(f'{vg_key:34} pokemon={len(game_pokemon):4} moves={len(game_moves):4} enc={len(encounters):4} bosses={len(bosses)}')

    core = {
        'games': games_meta,
        'pokemon': {str(pid): {k: v for k, v in pokemon[pid].items() if k != 'key' or True}
                    for pid in sorted(used_pokemon, key=int)},
    }
    with open(os.path.join(OUT, 'core.json'), 'w', encoding='utf-8') as f:
        json.dump(core, f, separators=(',', ':'), ensure_ascii=False)
    print('core pokemon:', len(core['pokemon']))

if __name__ == '__main__':
    main()
