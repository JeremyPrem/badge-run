"""Validate boss JSON files against PokeAPI identifiers.
Usage: python tools/validate_bosses.py data-src/bosses/<file>.json [...]"""
import csv, json, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
C = os.path.join(HERE, 'csv')
pokemon = {r['identifier'] for r in csv.DictReader(open(os.path.join(C, 'pokemon.csv'), encoding='utf-8'))}
moves = {r['identifier'] for r in csv.DictReader(open(os.path.join(C, 'moves.csv'), encoding='utf-8'))}
types = {r['identifier'] for r in csv.DictReader(open(os.path.join(C, 'types.csv'), encoding='utf-8'))}
vgs = {r['identifier'] for r in csv.DictReader(open(os.path.join(C, 'version_groups.csv'), encoding='utf-8'))}
versions = {r['identifier'] for r in csv.DictReader(open(os.path.join(C, 'versions.csv'), encoding='utf-8'))}
CATS = {'gym', 'trial', 'elite4', 'champion', 'rival', 'villain', 'postgame', 'other'}
ok = True
for path in sys.argv[1:]:
    errs = []
    d = json.load(open(path, encoding='utf-8'))
    if d.get('versionGroup') not in vgs: errs.append(f"bad versionGroup {d.get('versionGroup')}")
    ids = set()
    for i, b in enumerate(d.get('battles', [])):
        where = f"battle[{i}] {b.get('name')}"
        for k in ('id', 'name', 'title', 'category', 'team'):
            if k not in b: errs.append(f"{where}: missing {k}")
        if b.get('id') in ids: errs.append(f"{where}: duplicate id {b.get('id')}")
        ids.add(b.get('id'))
        if b.get('category') not in CATS: errs.append(f"{where}: bad category {b.get('category')}")
        if b.get('type') and b['type'] not in types: errs.append(f"{where}: bad type {b['type']}")
        for v in b.get('versions', []):
            if v not in versions: errs.append(f"{where}: bad version {v}")
        for m in b.get('team', []):
            if m.get('pokemon') not in pokemon: errs.append(f"{where}: unknown pokemon '{m.get('pokemon')}'")
            if not isinstance(m.get('level'), int): errs.append(f"{where}: {m.get('pokemon')} level not int")
            for mv in m.get('moves', []):
                if mv not in moves: errs.append(f"{where}: {m.get('pokemon')} unknown move '{mv}'")
            if m.get('tera') and m['tera'] not in types: errs.append(f"{where}: bad tera {m['tera']}")
    print(f"{path}: {len(d.get('battles', []))} battles, {'OK' if not errs else str(len(errs)) + ' errors'}")
    for e in errs: print('  -', e)
    ok = ok and not errs
sys.exit(0 if ok else 1)
