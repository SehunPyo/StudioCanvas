이 폴더는 "로컬에서 확인할 때"만 쓰는 폴더입니다.
깃에는 올라가지 않습니다 (../.gitignore 참고).

현재 페이지가 찾는 파일 이름 — v7.0.2
  Windows : Aurora-7.0.2-win.zip
  macOS   : Aurora-7.0.2-mac.dmg.zip

만드는 방법 (프로젝트 루트에서)
  npm run electron:build
  → dist/ 안에 생성됩니다. 그 파일을 이 폴더로 복사하세요.
    (이름은 electron-builder 기본 규칙입니다.
     productName = Aurora, version = package.json 의 version)


배포(Vercel)할 때는 이 폴더를 쓰지 않습니다
------------------------------------------------
설치 파일이 100MB 를 넘어서 깃허브 푸시와 Vercel 업로드가 모두 막힙니다.
  - GitHub : 파일 하나가 100MB 를 넘으면 푸시 거부
  - Vercel : 정적 파일 업로드 한도 Hobby 100MB / Pro 1GB
  - 현재 파일 : win 127.78MB, mac 148.25MB  → 둘 다 초과

그래서 설치 파일은 GitHub Releases 에 올리고,
다운로드 링크를 Releases URL 로 바꿉니다.

  href="downloads/Aurora-7.0.2-win.zip"
  →
  href="https://github.com/<계정>/<레포>/releases/download/v7.0.2/Aurora-7.0.2-win.zip"

바꿔야 할 곳 — 실제 파일 URL 은 ../products.json 한 곳에만 있습니다.

  ../products.json  ← 여기만 고칩니다
    products[].platforms.windows.downloadUrl
    products[].platforms.macos.downloadUrl

  고친 뒤 반드시 아래를 실행해 다운로드 페이지를 다시 만듭니다.
    python tools/build-downloads.py

  ../aurora.html 의 버튼 4개는 파일이 아니라 다운로드 전용 페이지
  (/download/aurora/windows, /download/aurora/macos)로 가므로
  URL 이 바뀌어도 건드릴 필요가 없습니다.


버전을 올렸다면 "7.0.2" 를 새 버전으로 모두 바꾸세요.

  ../products.json  (version, updatedAt, fileName, fileSize, downloadUrl)
    → 고친 뒤 python tools/build-downloads.py

  ../aurora.html
    - 다운로드 링크 href 4곳 + 버튼 아래 파일 이름 표기 4곳
    - 사이드바 v7.0.2 배지
    - 소개 섹션 dl-note 의 v7.0.2
    - 설치 안내 섹션의 파일 이름 2곳
    - 맨 아래 푸터 "Aurora 7.0.2"

  ../index.html
    - Aurora 카드의 card-meta "v7.0.2" 한 곳
