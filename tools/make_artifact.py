"""Turn index.html into artifact.html: the artifact host supplies <!doctype>/<html>/<head>/<body>,
so keep only the head's title/links and the body's contents."""
import os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
head = re.search(r'<head>(.*?)</head>', html, re.S).group(1)
body = re.search(r'<body>(.*?)</body>', html, re.S).group(1)
head = '\n'.join(l for l in head.strip().splitlines() if not l.strip().startswith('<meta'))
open(os.path.join(ROOT, 'artifact.html'), 'w', encoding='utf-8').write(head + '\n' + body.strip() + '\n')
print('wrote artifact.html')
