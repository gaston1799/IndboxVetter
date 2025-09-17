// Lightweight theme bootstrap: sets html[data-theme] early based on saved preference
(function(){
  try {
    var stored = localStorage.getItem('iv-theme');
    var theme;
    if (stored === 'dark' || stored === 'light') {
      theme = stored;
    } else {
      var prefersDark = false;
      try { prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; } catch {}
      theme = prefersDark ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
  } catch (_) {}
})();

// Optional helper to switch theme programmatically
window.setInboxVetterTheme = function(theme) {
  if (theme !== 'dark' && theme !== 'light') return;
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('iv-theme', theme); } catch {}
};

