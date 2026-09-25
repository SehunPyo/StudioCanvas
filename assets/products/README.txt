Studio Canvas — 제품 이미지 폴더
====================================

홈(index.html)의 제품 그리드에 들어가는 그림을 두는 곳입니다.

지금 들어 있는 것
--------------------------------------------------
  aurora-card.jpg   1400 x 1050 (4:3)
    → tools/mockup-aurora.html 을 크롬으로 찍어 만든 Aurora 앱 목업입니다.
      실물 스크린샷이 생기면 같은 이름으로 덮어쓰면 끝입니다. 코드는 그대로 두세요.

다시 만들려면
--------------------------------------------------
  python tools/make-mockups.py

  목업 화면 자체를 고치려면 tools/mockup-aurora.html 을 브라우저로 열어
  내용을 바꾼 뒤 위 명령을 다시 돌리면 됩니다.
  잘라 쓰는 영역과 크기는 make-mockups.py 맨 위 CROP / OUT_W / OUT_H 입니다.

새 제품을 그리드에 넣기
--------------------------------------------------
  index.html 의 "Coming Soon" 칸 하나를 골라 Aurora 카드 모양으로 바꿉니다.

    <div class="card soon" data-state="soon">
      <div class="card-vis coming"><span>Coming Soon</span></div>
    </div>

    ↓

    <a class="card" href="새제품.html" data-state="live">
      <div class="card-vis">
        <span class="card-badge">Download</span>
        <img src="assets/products/새제품-card.jpg" alt="새 제품 화면"
             width="1400" height="1050">
      </div>
      <div class="card-foot">
        <h3 class="card-name">새 제품</h3>
        <div class="card-tags"><span>업무</span><span>자동화</span></div>
        <span class="card-meta">v1.0.0</span>
      </div>
    </a>

  그리고 맨 위 거르기 버튼의 숫자(전체 16 / 출시 1 / 준비 중 15)도 함께 고칩니다.

그림 규격
--------------------------------------------------
  - 4:3, 1400 x 1050 권장. object-fit: cover 로 채우므로 비율이 달라도 됩니다.
  - 카드는 화면에서 300px 안팎으로 줄어듭니다.
    창 전체를 넣으면 아무것도 안 읽히니, 화면의 한 부분을 확대해 쓰세요.
  - 하나당 300KB 아래를 권장합니다.
