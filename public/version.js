(function(){
  function formatBuildTime(raw) {
    if (!raw) return "";
    try {
      const date = new Date(raw);
      if (!Number.isNaN(date.getTime())) {
        return date.toLocaleString();
      }
    } catch (_) {}
    return raw;
  }

  function renderFooter() {
    if (!document.body) return;
    if (document.getElementById("iv-version-footer")) return;

    const cfg = (window.INBOXVETTER_CONFIG || {});
    const version = cfg.VERSION ? `v${cfg.VERSION}` : "";
    const buildTimeRaw = cfg.BUILD_TIME;
    const buildTime = formatBuildTime(buildTimeRaw);
    const commit = typeof cfg.BUILD_COMMIT === "string" ? cfg.BUILD_COMMIT : "";

    const parts = [];
    if (version) parts.push(version);
    if (buildTime) parts.push(`built ${buildTime}`);
    if (commit) parts.push(commit.slice(0, 7));

    if (!parts.length) return;

    const footer = document.createElement("div");
    footer.id = "iv-version-footer";
    footer.setAttribute("role", "contentinfo");
    footer.textContent = `InboxVetter ${parts.join(" • ")}`;
    const tooltip = [];
    if (cfg.VERSION) tooltip.push(`Version: ${cfg.VERSION}`);
    if (buildTimeRaw) tooltip.push(`Build time: ${buildTimeRaw}`);
    if (commit) tooltip.push(`Commit: ${commit}`);
    if (tooltip.length) footer.title = tooltip.join("\n");
    footer.style.position = "fixed";
    footer.style.right = "16px";
    footer.style.bottom = "16px";
    footer.style.zIndex = "2147483647";
    footer.style.fontSize = "12px";
    footer.style.fontFamily = "ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial";
    footer.style.lineHeight = "1.4";
    footer.style.padding = "6px 12px";
    footer.style.borderRadius = "999px";
    footer.style.backgroundColor = "rgba(15, 23, 42, 0.82)";
    footer.style.color = "rgba(226, 232, 240, 0.95)";
    footer.style.boxShadow = "0 8px 20px rgba(15, 23, 42, 0.25)";
    footer.style.backdropFilter = "blur(8px)";
    footer.style.pointerEvents = "none";

    document.body.appendChild(footer);
  }

  function init() {
    if (typeof window === "undefined") return;
    if (!window.INBOXVETTER_CONFIG) {
      window.addEventListener("INBOXVETTER_CONFIG_READY", renderFooter, { once: true });
      return;
    }
    renderFooter();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
