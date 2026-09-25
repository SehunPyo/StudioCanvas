# -*- coding: utf-8 -*-
"""
Aurora 제품 이미지 생성기

tools/mockup-aurora.html (앱 창을 그대로 다시 그린 화면) 을 헤드리스 크롬으로
찍어 홈에서 쓰는 두 장을 만든다.

  python tools/make-mockups.py

  → assets/products/aurora-card.jpg   1400 x 1050  (제품 그리드 카드, 4:3)

카드는 320px 쯤으로 줄어드는 자리라, 창 전체를 넣으면 아무것도 안 읽힌다.
큰 화면으로 찍어 왼쪽(레일·사이드바·문서)만 4:3 으로 잘라 쓴다.

실물 스크린샷이 생기면 같은 이름으로 덮어쓰면 된다. 코드는 건드릴 필요 없다.
"""

import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, 'tools', 'mockup-aurora.html')
OUT = os.path.join(ROOT, 'assets', 'products')

RENDER_W, RENDER_H = 1800, 1125          # 목업을 찍는 크기
CROP = (0, 0, 1104, 828)                 # 레일 + 사이드바 + 문서 (4:3)
OUT_W, OUT_H = 1400, 1050                # 저장 크기

CHROME_CANDIDATES = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'google-chrome', 'chromium', 'chromium-browser',
]


def find_chrome():
    env = os.environ.get('CHROME')
    if env and (os.path.exists(env) or shutil.which(env)):
        return env
    for c in CHROME_CANDIDATES:
        if os.path.exists(c):
            return c
        found = shutil.which(c)
        if found:
            return found
    return None


def main():
    chrome = find_chrome()
    if not chrome:
        print('크롬을 찾지 못했습니다. CHROME 환경변수에 실행 파일 경로를 넣고 다시 실행하세요.')
        return 1

    os.makedirs(OUT, exist_ok=True)
    url = 'file:///' + PAGE.replace('\\', '/')

    with tempfile.TemporaryDirectory() as tmp:
        png = os.path.join(tmp, 'render.png')
        subprocess.run([
            chrome,
            '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
            '--allow-file-access-from-files',
            '--force-device-scale-factor=1',
            '--window-size=%d,%d' % (RENDER_W, RENDER_H),
            '--virtual-time-budget=4000',
            '--user-data-dir=' + os.path.join(tmp, 'profile'),
            '--screenshot=' + png,
            url,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)

        if not os.path.exists(png):
            print('렌더 실패')
            return 1

        img = Image.open(png).convert('RGB')
        img = img.crop(CROP).resize((OUT_W, OUT_H), Image.LANCZOS)
        path = os.path.join(OUT, 'aurora-card.jpg')
        img.save(path, quality=90, optimize=True, progressive=True)
        print('wrote', path, img.size)

    return 0


if __name__ == '__main__':
    sys.exit(main())
