"""Add/refresh a ?v=<timestamp> on index.html's local CSS/JS links so browsers fetch new code after a deploy
(GitHub Pages lets browsers cache files for 10 minutes). Run before committing code changes."""
import os, re, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
path = os.path.join(ROOT, 'index.html')
html = open(path, encoding='utf-8').read()
v = time.strftime('%Y%m%d%H%M%S')
html, n = re.subn(r'((?:src|href)="src/[^"?]+\.(?:js|css))(?:\?v=[^"]*)?"', rf'\1?v={v}"', html)
open(path, 'w', encoding='utf-8', newline='').write(html)
print(f'stamped {n} links with v={v}')
