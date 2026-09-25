/* Aurora 소개 페이지 동작
   - 다운로드 버튼: GitHub 최신 릴리즈에서 .exe / .dmg 를 찾아 바로 받게 한다.
     못 찾으면(API 한도 초과·오프라인) HTML 에 적힌 /download/aurora/<os> 페이지로 간다.
   - 버전 표기도 릴리즈 태그(v7.1.2 → 7.1.2)로 바뀐다.
   - 방문자의 OS 에 맞는 버튼을 앞(강조)으로 둔다. */
const RELEASE_API = 'https://api.github.com/repos/SehunPyo/Aurora_web_download/releases/latest';
const ASSET_EXT = { windows: '.exe', mac: '.dmg' };

document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });

fetch(RELEASE_API)
  .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
  .then((rel) => {
    const version = rel.tag_name.replace(/^v/, '');
    document.querySelectorAll('[data-version]').forEach((el) => { el.textContent = version; });
    document.querySelectorAll('[data-download]').forEach((btn) => {
      const asset = rel.assets.find((a) => a.name.endsWith(ASSET_EXT[btn.dataset.download]));
      if (asset) btn.href = asset.browser_download_url;
    });
  })
  .catch(() => {}); // 기본 링크(다운로드 페이지)가 그대로 남는다

// 방문자 OS 에 맞는 버튼을 강조(맥이면 macOS 버튼을 앞으로)
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
if (isMac) {
  document.querySelectorAll('[data-download-group]').forEach((group) => {
    const win = group.querySelector('[data-download="windows"]');
    const mac = group.querySelector('[data-download="mac"]');
    win.classList.replace('pill-primary', 'pill-secondary');
    mac.classList.replace('pill-secondary', 'pill-primary');
    group.prepend(mac);
  });
}

// 스크롤하면 나타나기(움직임 줄이기 설정이면 건너뜀)
if (!matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -10% 0px' });
  document.querySelectorAll('.tile, .mini, .use, .stat, .compare, details').forEach((el) => { el.classList.add('reveal'); io.observe(el); });
}

// 상단바: 어두운 구역(첫 화면·숫자 띠·다운로드) 위에 있을 때만 어둡게
const nav = document.querySelector('.nav');
const darkZones = [...document.querySelectorAll('.dark-hero, .trust, .download')];
const paintNav = () => {
  const y = nav.getBoundingClientRect().bottom;
  nav.classList.toggle('on-dark', darkZones.some((z) => { const r = z.getBoundingClientRect(); return r.top <= y && r.bottom >= y; }));
};
addEventListener('scroll', paintNav, { passive: true });
addEventListener('resize', paintNav);
paintNav();
