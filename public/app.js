const SKEY = "inboxVetter:setup";
const $ = id => document.getElementById(id);

function save(d){sessionStorage.setItem(SKEY, JSON.stringify(d))}
function load(){try{return JSON.parse(sessionStorage.getItem(SKEY)||"{}")}catch{return{}}}

async function fetchJSON(url, opts){const r=await fetch(url, opts); return r.json();}

async function whoami(){
  const r = await fetchJSON("/auth/me").catch(()=>({ok:false}));
  if (!r.ok) { location.href="/login.html"; return; }
  $("user").textContent = r.user.name || r.user.email;
}

async function loadCredits(){
  const r = await fetchJSON("/api/credits").catch(()=>({ok:false}));
  if (r.ok) $("credits").textContent = `Credits: ${r.credits}`;
}

$("logoutBtn").onclick = async () => {
  await fetch("/auth/logout",{method:"POST"});
  location.href="/login.html";
};

$("buyBtn").onclick = async () => {
  const r = await fetchJSON("/billing/checkout", { method:"POST" });
  if (r.ok && r.url) location = r.url; else alert(r.error || "Checkout failed");
};

const openaiKey=$("openaiKey"),omitted=$("omitted"),importantDesc=$("importantDesc");
const allowAttachments=$("allowAttachments"),maxMb=$("maxMb"),maxImages=$("maxImages"),maxPdfChars=$("maxPdfChars");
const modelSelect=$("modelSelect"),modelCustom=$("modelCustom"),customWrap=$("customModelWrap");
modelSelect.onchange=()=>customWrap.style.display=(modelSelect.value==="__custom")?"":"none";

$("saveBtn").onclick=()=>{
  let modelValue = modelSelect.value==="__custom" ? modelCustom.value.trim() : modelSelect.value;
  const d = {
    openaiKey: openaiKey.value.trim(),
    omittedSenders: omitted.value.trim(),
    importantDesc: importantDesc.value.trim(),
    allowAttachments: !!allowAttachments.checked,
    maxAttachmentMB: Number(maxMb.value || 5),
    maxImages: Number(maxImages.value || 3),
    maxPdfTextChars: Number(maxPdfChars.value || 4000),
    model: modelValue
  };
  save(d); $("saveStatus").textContent="Saved ✓";
};

$("loadBtn").onclick=()=>{
  const d = load();
  openaiKey.value = d.openaiKey || "";
  omitted.value = d.omittedSenders || "";
  importantDesc.value = d.importantDesc || "";
  allowAttachments.checked = d.allowAttachments ?? true;
  maxMb.value = d.maxAttachmentMB ?? 5;
  maxImages.value = d.maxImages ?? 3;
  maxPdfChars.value = d.maxPdfTextChars ?? 4000;

  const known = new Set(["","gpt-4.1-mini","gpt-4.1","gpt-5","o3-mini","o3","gpt-4o-mini","gpt-4o"]);
  const m = (d.model || "").trim();
  if (known.has(m)) { modelSelect.value=m || "gpt-4.1-mini"; customWrap.style.display="none"; modelCustom.value=""; }
  else if (m)      { modelSelect.value="__custom"; customWrap.style.display=""; modelCustom.value=m; }
  $("saveStatus").textContent="Loaded ✓";
};

// boot
whoami().then(loadCredits);
$("loadBtn").click();
