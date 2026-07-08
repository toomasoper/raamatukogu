import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BrowserMultiFormatReader } from "https://esm.sh/@zxing/browser@0.1.5";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- lühikäepidemed ----
const $ = (id) => document.getElementById(id);
const show = (el) => el.classList.remove("hidden");
const hide = (el) => el.classList.add("hidden");

let books = [];          // kõik read mälus (kodukogu on väike -> filtreerime kliendis)
let editingId = null;    // null = uus raamat
let scanReader = null;
let scanControls = null;

// Riidevärvid kaaneta raamatute "selja" jaoks
const CLOTHS = ["#35513f","#7a2f2a","#b3832f","#2f3d57","#4a3a52","#5a5245","#3b5052","#6a3b1f"];
const clothFor = (s) => {
  let h = 0; for (const c of (s||"?")) h = (h*31 + c.charCodeAt(0)) >>> 0;
  return CLOTHS[h % CLOTHS.length];
};
const esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const PLACEHOLDER_TITLE = "(andmed puudu)";

// ============================================================
// AUTENTIMINE
// Kasutame onAuthStateChange't ainsa allikana. Supabase kutsub selle
// kohe pärast lehe laadimist "INITIAL_SESSION" sündmusega, nii et
// getSession()-t pole vaja ja väldime lukustumist.
// ============================================================
function applySession(session) {
  hide($("loading"));
  if (session) { hide($("login")); show($("appwrap")); load(); }
  else { show($("login")); hide($("appwrap")); }
}

supa.auth.onAuthStateChange((_event, session) => applySession(session));

// Turvavõrk: kui onAuthStateChange mingil põhjusel 5 sek jooksul
// ei tulistanud, näitame vähemalt sisselogimise ekraani, mitte tühja lehte.
setTimeout(() => {
  if (!$("loading").classList.contains("hidden")) applySession(null);
}, 5000);

$("li-go").addEventListener("click", async () => {
  $("li-err").textContent = "";
  const email = $("li-email").value.trim();
  const password = $("li-pass").value;
  const { error } = await supa.auth.signInWithPassword({ email, password });
  if (error) $("li-err").textContent = "Sisselogimine ebaõnnestus. Kontrolli e-posti ja parooli.";
});
$("li-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") $("li-go").click(); });
$("logout").addEventListener("click", () => supa.auth.signOut());

// ============================================================
// ANDMED
// ============================================================
async function load() {
  const { data, error } = await supa.from("raamat").select("*").order("pealkiri", { ascending:true });
  if (error) { $("meta").textContent = "Andmete laadimine ebaõnnestus."; return; }
  books = data || [];
  fillFilterOptions();
  render();
}

function fillFilterOptions() {
  const zanrid = [...new Set(books.map(b => b.zanr).filter(Boolean))].sort();
  const sarjad = [...new Set(books.map(b => b.seeria).filter(Boolean))].sort();
  const opt = (v) => `<option value="${esc(v)}">${esc(v)}</option>`;
  $("f-zanr").innerHTML = `<option value="">Kõik žanrid</option>` + zanrid.map(opt).join("");
  $("f-seeria").innerHTML = `<option value="">Kõik sarjad</option>` + sarjad.map(opt).join("");
  $("dl-zanr").innerHTML = zanrid.map(v => `<option value="${esc(v)}">`).join("");
  $("dl-seeria").innerHTML = sarjad.map(v => `<option value="${esc(v)}">`).join("");
}

// ============================================================
// FILTREERIMINE + KUVA
// ============================================================
function filtered() {
  const q = $("q").value.trim().toLowerCase();
  const fz = $("f-zanr").value, fs = $("f-seeria").value, fst = $("f-staatus").value;
  return books.filter(b => {
    if (fz && b.zanr !== fz) return false;
    if (fs && b.seeria !== fs) return false;
    if (fst === "kodus" && b.laenatud_kellele) return false;
    if (fst === "valjas" && !b.laenatud_kellele) return false;
    if (q) {
      const hay = [b.pealkiri,b.autor,b.isbn,b.kirjastus,b.zanr,b.seeria,b.asukoht,b.laenatud_kellele]
        .filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function render() {
  const list = filtered();
  $("meta").textContent = `${list.length} raamatut${list.length !== books.length ? ` (${books.length}-st)` : ""}`;
  const grid = $("grid"), empty = $("empty");
  if (list.length === 0) {
    grid.innerHTML = "";
    empty.innerHTML = books.length === 0
      ? "<p>Riiul on veel tühi.</p><p>Vajuta „+ Lisa raamat“ ja skanni esimene vöötkood.</p>"
      : "<p>Ükski raamat ei vasta otsingule.</p>";
    show(empty);
    return;
  }
  hide(empty);
  grid.innerHTML = list.map(cardHtml).join("");
  grid.querySelectorAll("[data-id]").forEach(el =>
    el.addEventListener("click", () => openEditor(el.dataset.id)));
}

function coverHtml(b) {
  const laen = b.laenatud_kellele
    ? `<span class="badge">Väljas · ${esc(b.laenatud_kellele)}</span>` : "";
  const puudu = b.pealkiri === PLACEHOLDER_TITLE
    ? `<span class="badge puudu">andmed puudu</span>` : "";
  // Selg on alati taustal; kaanepilt (kui on) katab selle. Katkise pildi peidame -> selg jääb nähtavale.
  const img = b.kaane_url
    ? `<img src="${esc(b.kaane_url)}" alt="" loading="lazy" onerror="this.style.display='none'">` : "";
  return `<div class="cover">${spineHtml(b)}${img}${laen || puudu}</div>`;
}
function spineHtml(b) {
  return `<div class="spine" style="background:${clothFor(b.pealkiri||b.autor)}">
    <div class="st">${esc(b.pealkiri||"Pealkirjata")}</div>
    <div class="sa">${esc(b.autor||"")}</div></div>`;
}
function cardHtml(b) {
  const tags = [];
  if (b.zanr) tags.push(`<span class="tag">${esc(b.zanr)}</span>`);
  if (b.seeria) tags.push(`<span class="tag">${esc(b.seeria)}${b.seeria_nr!=null?` #${esc(b.seeria_nr)}`:""}</span>`);
  return `<button class="card" data-id="${b.id}">
    ${coverHtml(b)}
    <div class="ctitle">${esc(b.pealkiri||"Pealkirjata")}</div>
    <div class="cauthor">${esc(b.autor||"—")}</div>
    <div class="ctags">${tags.join("")}</div>
  </button>`;
}

["q","f-zanr","f-seeria","f-staatus"].forEach(id => $(id).addEventListener("input", render));

// ============================================================
// EDITOR (lisa / muuda)
// ============================================================
function openEditor(id) {
  editingId = id || null;
  const b = id ? books.find(x => x.id === id) : {};
  $("ed-title").textContent = id ? "Muuda raamatut" : "Lisa raamat";
  $("ed-isbn").value = b.isbn || "";
  $("ed-pealkiri").value = b.pealkiri || "";
  $("ed-autor").value = b.autor || "";
  $("ed-zanr").value = b.zanr || "";
  $("ed-keel").value = b.keel || "";
  $("ed-seeria").value = b.seeria || "";
  $("ed-seerianr").value = b.seeria_nr ?? "";
  $("ed-kirjastus").value = b.kirjastus || "";
  $("ed-aasta").value = b.aasta ?? "";
  $("ed-asukoht").value = b.asukoht || "";
  $("ed-laenatud").value = b.laenatud_kellele || "";
  $("ed-laenkuup").value = b.laenatud_kuup || "";
  $("ed-kaane").value = b.kaane_url || "";
  $("ed-lookup").textContent = "";
  $("ed-err").textContent = "";
  $("ed-delrow").style.display = id ? "flex" : "none";
  updateEdCover();
  show($("editor"));
}
function closeEditor(){ hide($("editor")); editingId = null; }

function updateEdCover() {
  const b = { kaane_url:$("ed-kaane").value.trim(), pealkiri:$("ed-pealkiri").value, autor:$("ed-autor").value };
  const img = b.kaane_url ? `<img src="${esc(b.kaane_url)}" alt="" onerror="this.style.display='none'">` : "";
  $("ed-cover").innerHTML = spineHtml(b) + img;
}
["ed-kaane","ed-pealkiri","ed-autor"].forEach(id => $(id).addEventListener("input", updateEdCover));

$("add").addEventListener("click", () => openEditor(null));
$("ed-cancel").addEventListener("click", closeEditor);
$("editor").addEventListener("click", (e) => { if (e.target.id === "editor") closeEditor(); });

$("ed-save").addEventListener("click", async () => {
  $("ed-err").textContent = "";
  const rec = {
    isbn: $("ed-isbn").value.trim() || null,
    pealkiri: $("ed-pealkiri").value.trim(),
    autor: $("ed-autor").value.trim() || null,
    zanr: $("ed-zanr").value.trim() || null,
    keel: $("ed-keel").value.trim() || null,
    seeria: $("ed-seeria").value.trim() || null,
    seeria_nr: $("ed-seerianr").value.trim() ? Number($("ed-seerianr").value.trim()) : null,
    kirjastus: $("ed-kirjastus").value.trim() || null,
    aasta: $("ed-aasta").value.trim() ? parseInt($("ed-aasta").value.trim(),10) : null,
    asukoht: $("ed-asukoht").value.trim() || null,
    laenatud_kellele: $("ed-laenatud").value.trim() || null,
    laenatud_kuup: $("ed-laenkuup").value || null,
    kaane_url: $("ed-kaane").value.trim() || null,
  };
  if (!rec.pealkiri) { $("ed-err").textContent = "Pealkiri on kohustuslik."; return; }

  let error;
  if (editingId) ({ error } = await supa.from("raamat").update(rec).eq("id", editingId));
  else           ({ error } = await supa.from("raamat").insert(rec));

  if (error) {
    if (error.code === "23505") $("ed-err").textContent = "See ISBN on juba kodus — raamat on riiulis olemas.";
    else $("ed-err").textContent = "Salvestamine ebaõnnestus: " + error.message;
    return;
  }
  closeEditor();
  await load();
});

$("ed-delete").addEventListener("click", async () => {
  if (!editingId) return;
  if (!confirm("Kustutan selle raamatu riiulist?")) return;
  const { error } = await supa.from("raamat").delete().eq("id", editingId);
  if (error) { $("ed-err").textContent = "Kustutamine ebaõnnestus."; return; }
  closeEditor();
  await load();
});

// ============================================================
// ISBN -> METAANDMED (Google Books, siis Open Library)
// ============================================================
async function lookupIsbn(isbn) {
  const clean = isbn.replace(/[^0-9Xx]/g, "");
  // 1) Google Books
  try {
    const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${clean}`);
    const d = await r.json();
    if (d.totalItems > 0) {
      const v = d.items[0].volumeInfo || {};
      const cover = (v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "").replace(/^http:/, "https:");
      return {
        pealkiri: v.title ? v.title + (v.subtitle ? `: ${v.subtitle}` : "") : "",
        autor: (v.authors || []).join(", "),
        kirjastus: v.publisher || "",
        aasta: v.publishedDate ? (v.publishedDate.match(/\d{4}/)||[""])[0] : "",
        keel: v.language || "",
        zanr: (v.categories || [])[0] || "",
        kaane_url: cover,
      };
    }
  } catch (e) { /* proovime järgmist allikat */ }
  // 2) Open Library
  try {
    const r = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${clean}&format=json&jscmd=data`);
    const d = await r.json();
    const b = d[`ISBN:${clean}`];
    if (b) {
      return {
        pealkiri: b.title || "",
        autor: (b.authors || []).map(a => a.name).join(", "),
        kirjastus: (b.publishers || [])[0]?.name || "",
        aasta: b.publish_date ? (b.publish_date.match(/\d{4}/)||[""])[0] : "",
        keel: "",
        zanr: (b.subjects || [])[0]?.name || "",
        kaane_url: b.cover?.large || b.cover?.medium || `https://covers.openlibrary.org/b/isbn/${clean}-L.jpg`,
      };
    }
  } catch (e) { /* jätkame ilma */ }
  return null;
}

async function fillFromIsbn(isbn) {
  if (!isbn) return;
  $("ed-lookup").innerHTML = "Otsin andmeid…";
  const m = await lookupIsbn(isbn);
  const clean = isbn.replace(/[^0-9Xx]/g, "");
  if (!m) {
    // Eesti raamatuid pole rahvusvahelistes andmebaasides sageli — pakume abi eesti kataloogidest
    $("ed-lookup").innerHTML =
      `Selle ISBN-i andmeid ei leitud. Proovi eesti kataloogist: ` +
      `<a href="https://www.ester.ee/search~S1*est/?searchtype=i&searcharg=${clean}" target="_blank" rel="noopener">ESTER</a> · ` +
      `<a href="https://erb.nlib.ee/?otsi=${clean}&f=isbn" target="_blank" rel="noopener">Rahvusraamatukogu</a>. ` +
      `Kopeeri sealt pealkiri ja autor.`;
    // pakume vähemalt kaanepilti ISBN-i järgi
    if (!$("ed-kaane").value) $("ed-kaane").value = `https://covers.openlibrary.org/b/isbn/${clean}-L.jpg`;
    updateEdCover();
    return;
  }
  // täidame ainult tühjad väljad, et käsitsi sisestatut mitte üle kirjutada
  const set = (id, val) => { if (val && !$(id).value) $(id).value = val; };
  set("ed-pealkiri", m.pealkiri);
  set("ed-autor", m.autor);
  set("ed-kirjastus", m.kirjastus);
  set("ed-aasta", m.aasta);
  set("ed-keel", m.keel);
  set("ed-zanr", m.zanr);
  set("ed-kaane", m.kaane_url);
  $("ed-lookup").textContent = "Andmed täidetud — kontrolli ja täienda (nt žanr, sari).";
  updateEdCover();
}

$("ed-isbn").addEventListener("change", () => fillFromIsbn($("ed-isbn").value.trim()));

// ============================================================
// SKANNER (ZXing)
// ============================================================
async function startScanner() {
  show($("scanner"));
  $("scan-note").textContent = "Suuna kaamera raamatu tagakaane vöötkoodile.";
  try {
    scanReader = new BrowserMultiFormatReader();
    scanControls = await scanReader.decodeFromVideoDevice(undefined, $("scanvideo"), (result) => {
      if (result) {
        const code = result.getText();
        stopScanner();
        $("ed-isbn").value = code;
        fillFromIsbn(code);
      }
    });
  } catch (e) {
    $("scan-note").textContent = "Kaamerale ligipääs ebaõnnestus. Luba kaamera või sisesta ISBN käsitsi.";
  }
}
function stopScanner() {
  try { scanControls?.stop(); } catch(e){}
  scanControls = null; scanReader = null;
  hide($("scanner"));
}
$("ed-scan").addEventListener("click", startScanner);
$("scan-cancel").addEventListener("click", stopScanner);
$("scanner").addEventListener("click", (e) => { if (e.target.id === "scanner") stopScanner(); });

// ============================================================
// KIIRLISA — kaamera lahti, iga skann salvestub kohe.
// Andmed täidetakse hiljem rikastamise sammuga (etapp 1).
// ============================================================
let qsReader = null, qsControls = null;
let qsCount = 0;
let qsRecent = [];                 // uusimad üleval
const qsSeen = new Map();          // debounce: kood -> viimane skannimise aeg
const QS_DEBOUNCE_MS = 3000;

// ISBN-13 (või ISBN-10) — vöötkood on peaaegu alati EAN-13 (algab 978/979)
function isValidIsbn(code) {
  const c = (code || "").replace(/[^0-9Xx]/g, "");
  return c.length === 13 || c.length === 10;
}

// Lühikesed piiksud Web Audio kaudu — pole väliseid faile
let audioCtx = null;
function beep(freq, ms, gain = 0.05) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine"; o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + ms / 1000);
  } catch (e) { /* mõnes brauseris pole heli lubatud enne kasutaja klõpsu — pole hädavajalik */ }
}
const beepOk  = () => beep(880, 90);
const beepDup = () => { beep(330, 70); setTimeout(() => beep(330, 70), 110); };
const beepErr = () => { beep(220, 180, 0.06); };

function qsFlash(cls) {
  const f = $("qs-flash");
  f.classList.remove("ok", "dup", "err");
  // väike triik: sunni reflow, et animatsioon uuesti käivituks
  void f.offsetWidth;
  f.classList.add(cls);
  setTimeout(() => f.classList.remove(cls), 350);
}

function qsAddRow(isbn, cls, text) {
  qsRecent.unshift({ isbn, cls, text });
  qsRecent = qsRecent.slice(0, 8);
  $("qs-list").innerHTML = qsRecent.map(r =>
    `<div class="qs-row ${r.cls}"><span class="isbn">${esc(r.isbn)}</span><span class="st">${esc(r.text)}</span></div>`
  ).join("");
}

async function qsHandleCode(code) {
  const clean = code.replace(/[^0-9Xx]/g, "");
  // debounce: sama kood <3s tagasi — ignoreeri
  const last = qsSeen.get(clean);
  const now = Date.now();
  if (last && now - last < QS_DEBOUNCE_MS) return;
  qsSeen.set(clean, now);

  if (!isValidIsbn(clean)) {
    qsFlash("err"); beepErr();
    qsAddRow(clean || "(tundmatu)", "err", "pole ISBN");
    return;
  }

  // Duplikaat kohalikus mälus? (kiireim kontroll, väldib serveri edasi-tagasi käiku)
  if (books.some(b => b.isbn === clean)) {
    qsFlash("dup"); beepDup();
    qsAddRow(clean, "dup", "juba riiulis");
    return;
  }

  // Kata katse: sisesta minimaalne kirje. ISBN-i unikaalsuspiirang püüab kinni
  // ka võistlusolukorra (kui teine pereliige samal ajal sama raamatu lisab).
  const rec = { isbn: clean, pealkiri: PLACEHOLDER_TITLE };
  const { data, error } = await supa.from("raamat").insert(rec).select().single();
  if (error) {
    if (error.code === "23505") {
      qsFlash("dup"); beepDup();
      qsAddRow(clean, "dup", "juba riiulis");
      // kui teine seade oli lisanud, uuenda oma kohalikku vaadet
      await load();
    } else {
      qsFlash("err"); beepErr();
      qsAddRow(clean, "err", "salvestus ebaõnnestus");
      console.error(error);
    }
    return;
  }

  // Õnnestus
  books.push(data);          // hoia kohalikult sünkroonis, et järgmine skann tunneks duplikaadi
  qsCount += 1;
  $("qs-count").textContent = qsCount;
  qsFlash("ok"); beepOk();
  qsAddRow(clean, "ok", "lisatud");
}

async function startQuickScan() {
  qsCount = 0; qsRecent = []; qsSeen.clear();
  $("qs-count").textContent = "0";
  $("qs-list").innerHTML = "";
  $("qs-hint").textContent = "Suuna kaamera vöötkoodile — järgmine skann käib automaatselt.";
  show($("quickscan"));
  try {
    qsReader = new BrowserMultiFormatReader();
    qsControls = await qsReader.decodeFromVideoDevice(undefined, $("qs-video"), (result) => {
      if (result) qsHandleCode(result.getText());
    });
  } catch (e) {
    $("qs-hint").textContent = "Kaamerale ligipääs ebaõnnestus. Kontrolli, et brauseril oleks kaamera luba.";
  }
}
function stopQuickScan() {
  try { qsControls?.stop(); } catch (e) {}
  qsControls = null; qsReader = null;
  hide($("quickscan"));
  // Refresh kogu vaadet, et filterivalikud ja loendus uueneksid
  fillFilterOptions();
  render();
}

$("quickadd").addEventListener("click", startQuickScan);
$("qs-close").addEventListener("click", stopQuickScan);
$("quickscan").addEventListener("click", (e) => { if (e.target.id === "quickscan") stopQuickScan(); });

// ---- käivitus ---- (autentimist käivitab onAuthStateChange INITIAL_SESSION sündmusega automaatselt)
