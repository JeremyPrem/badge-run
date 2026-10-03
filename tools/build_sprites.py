"""Download PokeAPI sprites for every Pokemon in data/core.json and pack them into one sheet.

Outputs data/sprites.png (64px cells) and data/sprites.json ({pokemonId: cellIndex}).
Downloaded PNGs are cached in tools/sprite-cache/.
Run after build_data.py: python tools/build_sprites.py
"""
import json, os, io, math, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', 'sprite-cache')
BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/{}.png'
CELL = 64
COLS = 40

def fetch(pid):
    path = os.path.join(CACHE, f'{pid}.png')
    if os.path.exists(path):
        return pid, path if os.path.getsize(path) else None
    try:
        with urllib.request.urlopen(BASE.format(pid), timeout=30) as r:
            data = r.read()
    except Exception:
        data = b''
    with open(path, 'wb') as f:
        f.write(data)
    return pid, path if data else None

def main():
    os.makedirs(CACHE, exist_ok=True)
    core = json.load(open(os.path.join(ROOT, 'data', 'core.json'), encoding='utf-8'))
    ids = sorted(core['pokemon'], key=int)
    with ThreadPoolExecutor(16) as ex:
        paths = dict(ex.map(fetch, ids))
    # Forms without their own sprite fall back to the species' default sprite.
    for pid in ids:
        if not paths.get(pid):
            sp = str(core['pokemon'][pid]['species'])
            paths[pid] = paths.get(sp) or fetch(sp)[1]
    have = [pid for pid in ids if paths.get(pid)]
    rows = math.ceil(len(have) / COLS)
    sheet = Image.new('RGBA', (COLS * CELL, rows * CELL), (0, 0, 0, 0))
    index = {}
    cells = {}
    for pid in have:
        p = paths[pid]
        if p in cells:
            index[pid] = cells[p]
            continue
        img = Image.open(p).convert('RGBA')
        bbox = img.getbbox()
        if not bbox:
            continue
        img = img.crop(bbox)
        scale = min(1.0, (CELL - 4) / max(img.size))
        if scale < 1:
            img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
        n = len(cells)
        x, y = (n % COLS) * CELL, (n // COLS) * CELL
        sheet.paste(img, (x + (CELL - img.width) // 2, y + CELL - 2 - img.height), img)
        cells[p] = n
        index[pid] = n
    used_rows = math.ceil(len(cells) / COLS)
    sheet = sheet.crop((0, 0, COLS * CELL, used_rows * CELL))
    sheet = sheet.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    sheet.save(os.path.join(ROOT, 'data', 'sprites.png'), optimize=True)
    json.dump({'cell': CELL, 'cols': COLS, 'rows': used_rows, 'index': index},
              open(os.path.join(ROOT, 'data', 'sprites.json'), 'w'), separators=(',', ':'))
    print(f'{len(index)} pokemon, {len(cells)} unique sprites, missing: {len(ids) - len(index)}')

if __name__ == '__main__':
    main()
