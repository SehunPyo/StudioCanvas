# -*- coding: utf-8 -*-
"""
다운로드 전용 페이지 생성기

products.json 을 읽어 아래 경로에 정적 페이지를 만든다.

    /download/<slug>/<platform>/index.html
    예) /download/aurora/windows , /download/aurora/macos

  python tools/build-downloads.py

이 사이트는 Next.js 가 아니라 정적 HTML 이라 동적 라우트가 없다. 대신
데이터 한 곳(products.json)에서 URL 구조가 같은 실제 파일을 찍어낸다.
Vercel 은 디렉터리의 index.html 을 그 경로로 그대로 서빙한다.

제품이나 버전을 바꿨으면 products.json 을 고치고 이 스크립트를 다시 돌린다.
"""

import html
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'products.json')
OUT_ROOT = os.path.join(ROOT, 'download')

# Google AdSense — 사이트 전체에서 같은 스니펫을 쓴다.
ADSENSE = (
    '<script async '
    'src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js'
    '?client=ca-pub-9340425102772278"\n     crossorigin="anonymous"></script>'
)

PLATFORM_ORDER = ['windows', 'macos', 'linux']

# products.json 에 releaseRepo 와 platform 별 assetExt 가 있으면 넣는 스크립트.
# 최신 릴리즈에서 그 확장자로 끝나는 파일을 찾아 버튼 주소와 표의 값을 바꾼다.
# API 를 못 부르면(한도 초과·오프라인) products.json 의 값이 그대로 남는다.
RELEASE_JS = """
<script>
fetch(%(api)s)
  .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
  .then((rel) => {
    const a = rel.assets.find((x) => x.name.endsWith(%(ext)s));
    if (!a) return;
    const set = (k, v) => document.querySelectorAll('[data-rel="' + k + '"]').forEach((el) => { el.textContent = v; });
    set('version', rel.tag_name.replace(/^v/, ''));
    set('size', Math.round(a.size / 1048576) + ' MB');
    set('date', (rel.published_at || '').slice(0, 10));
    set('name', a.name);
    document.getElementById('dlGo').href = a.browser_download_url;
  })
  .catch(() => {});
</script>
"""


def esc(v):
    return html.escape(str(v), quote=True)


def page(product, key, plat):
    name = product['name']
    label = plat.get('label', key)
    other = []
    for k in PLATFORM_ORDER:
        if k != key and k in product.get('platforms', {}):
            other.append((k, product['platforms'][k].get('label', k)))

    other_html = ''
    if other:
        links = ' '.join(
            '<a href="/download/%s/%s">%s</a>' % (esc(product['slug']), esc(k), esc(lbl))
            for k, lbl in other
        )
        other_html = (
            '\n      <p class="dl-other"><span>다른 운영체제</span>%s</p>' % links
        )

    # data-rel 이 붙은 칸은 페이지를 열 때 GitHub 최신 릴리즈 값으로 바뀐다.
    rows = [
        ('운영체제', esc(plat.get('requirement', label)), ''),
        ('버전', esc(product['version']), ' data-rel="version"'),
        ('파일 크기', esc(plat['fileSize']), ' data-rel="size"'),
        ('업데이트', esc(product['updatedAt']), ' data-rel="date"'),
    ]
    if plat.get('fileName'):
        rows.append(('파일 이름', esc(plat['fileName']), ' class="mono" data-rel="name"'))

    spec = '\n'.join(
        '          <div><dt>%s</dt><dd%s>%s</dd></div>' % (dt, cls, dd)
        for dt, dd, cls in rows
    )

    title = '%s %s 다운로드 — Studio Canvas' % (name, label)
    desc = '%s %s용 설치 파일을 내려받습니다. 버전 %s · %s' % (
        name, label, product['version'], plat['fileSize'])

    release = ''
    if product.get('releaseRepo') and plat.get('assetExt'):
        release = RELEASE_JS % {
            'api': json.dumps('https://api.github.com/repos/%s/releases/latest' % product['releaseRepo']),
            'ext': json.dumps(plat['assetExt']),
        }

    return """<!doctype html>
<!--
  이 파일은 손으로 고치지 않는다.
  products.json 을 고친 뒤 'python tools/build-downloads.py' 를 다시 돌린다.
-->
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>%(title)s</title>
<meta name="description" content="%(desc)s">
<meta property="og:title" content="%(title)s">
<meta property="og:description" content="%(desc)s">
<meta property="og:type" content="website">
<meta property="og:image" content="/assets/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#08080a">
<link rel="icon" href="/assets/favicon-32.png" sizes="32x32">
<link rel="canonical" href="/download/%(slug)s/%(key)s">

<!-- Google AdSense -->
%(adsense)s

<link rel="stylesheet" href="/studio.css">
<link rel="stylesheet" href="/download.css">
</head>
<body class="dl-page">

<header class="dl-top">
  <div class="dl-top-in">
    <a class="dl-mark" href="/"><i aria-hidden="true"></i>Studio&nbsp;Canvas</a>
    <a class="dl-back-top" href="%(productPage)s">%(name)s 제품 페이지</a>
  </div>
</header>

<main class="dl-main">
  <div class="dl-card">
    <img class="dl-icon" src="%(icon)s" alt="" width="56" height="56">

    <h1 class="dl-name">%(name)s</h1>
    <p class="dl-sub">%(label)s · 설치 파일 내려받기</p>

    <dl class="dl-spec">
%(spec)s
    </dl>

    <a class="dl-go" id="dlGo" href="%(url)s" rel="noopener">%(label)s용 내려받기</a>
    <p class="dl-hint">버튼을 누르면 내려받기가 시작됩니다. %(hint)s</p>%(other)s
  </div>
</main>

<footer class="dl-foot">
  <a href="/">Studio Canvas</a> · <a href="%(productPage)s">%(name)s</a>
</footer>
%(release)s
</body>
</html>
""" % {
        'title': esc(title),
        'desc': esc(desc),
        'adsense': ADSENSE,
        'slug': esc(product['slug']),
        'key': esc(key),
        'name': esc(name),
        'label': esc(label),
        'icon': esc(product.get('icon', '/assets/icon-64.png')),
        'productPage': esc(product.get('productPage', '/')),
        'spec': spec,
        'url': esc(plat['downloadUrl']),
        'hint': esc(plat.get('hint', '받은 뒤 압축을 풀어 설치하세요.')),
        'other': other_html,
        'release': release,
    }


def main():
    with open(DATA, encoding='utf-8') as f:
        data = json.load(f)

    made = 0
    for product in data.get('products', []):
        platforms = product.get('platforms', {})
        for key in sorted(platforms, key=lambda k: (PLATFORM_ORDER + [k]).index(k)):
            plat = platforms[key]
            if not plat.get('downloadUrl'):
                print('건너뜀 (downloadUrl 없음):', product['slug'], key)
                continue

            out_dir = os.path.join(OUT_ROOT, product['slug'], key)
            os.makedirs(out_dir, exist_ok=True)
            path = os.path.join(out_dir, 'index.html')
            with open(path, 'w', encoding='utf-8', newline='\n') as f:
                f.write(page(product, key, plat))
            print('wrote /download/%s/%s' % (product['slug'], key))
            made += 1

    print('총 %d 개' % made)
    return 0


if __name__ == '__main__':
    sys.exit(main())
