(function () {
  var SUPABASE_URL = 'https://lhgkfgwtmpfxyxwyaroh.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_ZElENBh86p0cWQDAnSbNWw_EcOQHmDV';
  if (!window.supabase) return;
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  var style = document.createElement('style');
  style.textContent =
    '.aitakip-nav-btn { position: fixed; top: 14px; left: 14px; z-index: 1000; width: 42px; height: 42px; border-radius: 50%; background: var(--panel, #1c1e2c); border: 1px solid var(--hairline, #33364c); color: var(--paper, #edebe4); font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,.3); }' +
    '.aitakip-nav-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 999; opacity: 0; pointer-events: none; transition: opacity .2s; }' +
    '.aitakip-nav-overlay.open { opacity: 1; pointer-events: auto; }' +
    '.aitakip-nav-drawer { position: fixed; top: 0; left: 0; bottom: 0; width: 230px; background: var(--panel, #1c1e2c); border-right: 1px solid var(--hairline, #33364c); z-index: 1001; transform: translateX(-100%); transition: transform .25s; padding: 66px 0 20px; font-family: "IBM Plex Mono", monospace; overflow-y: auto; }' +
    '.aitakip-nav-drawer.open { transform: translateX(0); }' +
    '.aitakip-nav-drawer a, .aitakip-nav-drawer button.aitakip-item { display: block; width: 100%; text-align: left; padding: 14px 22px; color: var(--paper, #edebe4); text-decoration: none; background: none; border: none; font-family: inherit; font-size: 13px; cursor: pointer; letter-spacing: .03em; }' +
    '.aitakip-nav-drawer a:hover, .aitakip-nav-drawer button.aitakip-item:hover { background: var(--hairline-soft, #262838); }' +
    '.aitakip-nav-drawer a.active { color: var(--brass, #c9a34e); }' +
    '.aitakip-nav-sep { height: 1px; background: var(--hairline, #33364c); margin: 10px 0; }';
  document.head.appendChild(style);

  var btn = document.createElement('button');
  btn.className = 'aitakip-nav-btn';
  btn.innerHTML = '☰';
  btn.setAttribute('aria-label', 'Menü');

  var overlay = document.createElement('div');
  overlay.className = 'aitakip-nav-overlay';

  var drawer = document.createElement('div');
  drawer.className = 'aitakip-nav-drawer';

  function makeLink(href, label) {
    var a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (location.pathname.split('/').pop() === href) a.classList.add('active');
    return a;
  }

  function syncThemeLabel(themeBtn) {
    var t = localStorage.getItem('aitakip_theme') || 'dark';
    themeBtn.textContent = t === 'dark' ? '☀ Aydınlık Tema' : '🌙 Karanlık Tema';
  }

  function build(isAdmin) {
    drawer.innerHTML = '';
    drawer.appendChild(makeLink('index.html', '🎮 Oyun'));
    drawer.appendChild(makeLink('profile.html', '👤 Profil'));
    drawer.appendChild(makeLink('leaderboard.html', '🏆 Sıralama'));
    drawer.appendChild(makeLink('history.html', '📚 Geçmiş'));
    drawer.appendChild(makeLink('live.html', '⚡ Canlı Yarışma'));
    if (isAdmin) drawer.appendChild(makeLink('admin.html', '🛠 Admin Paneli'));

    var sep = document.createElement('div');
    sep.className = 'aitakip-nav-sep';
    drawer.appendChild(sep);

    var themeBtn = document.createElement('button');
    themeBtn.className = 'aitakip-item';
    syncThemeLabel(themeBtn);
    themeBtn.onclick = function () {
      var t = localStorage.getItem('aitakip_theme') || 'dark';
      var next = t === 'dark' ? 'light' : 'dark';
      localStorage.setItem('aitakip_theme', next);
      document.documentElement.setAttribute('data-theme', next);
      syncThemeLabel(themeBtn);
    };
    drawer.appendChild(themeBtn);

    var logoutBtn = document.createElement('button');
    logoutBtn.className = 'aitakip-item';
    logoutBtn.textContent = '🚪 Çıkış Yap';
    logoutBtn.onclick = function () {
      sb.auth.signOut().then(function () { location.href = 'index.html'; });
    };
    drawer.appendChild(logoutBtn);
  }

  function openDrawer() { overlay.classList.add('open'); drawer.classList.add('open'); }
  function closeDrawer() { overlay.classList.remove('open'); drawer.classList.remove('open'); }

  sb.auth.getSession().then(function (res) {
    var uid = res.data.session && res.data.session.user.id;
    if (!uid) return;
    build(false);
    document.body.appendChild(overlay);
    document.body.appendChild(drawer);
    document.body.appendChild(btn);
    btn.onclick = openDrawer;
    overlay.onclick = closeDrawer;
    sb.from('profiles').select('is_admin').eq('id', uid).single().then(function (r) {
      if (r.data && r.data.is_admin) build(true);
    });
  });
})();
