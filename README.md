# Studio Canvas

Studio Canvas 홈페이지와 제품 페이지. 빌드 도구 없는 정적 사이트입니다(Vercel 이 그대로 서빙).

| 제품 | 페이지 | 설치 파일(릴리즈) 저장소 |
|---|---|---|
| Aurora | `aurora.html` | `SehunPyo/Aurora_web_download` |
| FileConnect | `fileconnect.html` | `SehunPyo/FileConnect_Web_Download` |

제품마다 릴리즈 저장소를 따로 둡니다. 페이지는 그 저장소의 **최신 릴리즈**에서 설치 파일을 찾아 버튼에 연결하므로, 새 버전을 내도 이 저장소는 고칠 필요가 없습니다(홈 카드의 `v1.0.0` 같은 표기만 예외).

- 다운로드 전용 페이지: `products.json` 을 고친 뒤 `python tools/build-downloads.py`
- 새 제품 추가: `assets/products/README.txt` 참고, `products.json` 에 `releaseRepo` 를 그 제품의 릴리즈 저장소로
