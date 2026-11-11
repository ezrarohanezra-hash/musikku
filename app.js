"use strict";
const $ = (id) => document.getElementById(id);
const audio = $("audio");
let lagu = [];          // [{id, nama, ukuran, blob}]
let tampil = [];        // hasil filter
let idx = -1;           // indeks lagu aktif (di array `tampil`)
let acak = false, ulang = false, urlAktif = null;

/* ---------- IndexedDB ---------- */
const DB = new Promise((ok, gagal) => {
  const r = indexedDB.open("musikku", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("lagu", { keyPath: "id", autoIncrement: true });
  r.onsuccess = () => ok(r.result);
  r.onerror = () => gagal(r.error);
});
async function tx(mode, fn) {
  const db = await DB;
  return new Promise((ok, gagal) => {
    const t = db.transaction("lagu", mode);
    const hasil = fn(t.objectStore("lagu"));
    t.oncomplete = () => ok(hasil.result);
    t.onerror = () => gagal(t.error);
  });
}
const semua = () => tx("readonly", (s) => s.getAll());
const simpan = (o) => tx("readwrite", (s) => s.add(o));
const ubah = (o) => tx("readwrite", (s) => s.put(o));
const hapusDb = (id) => tx("readwrite", (s) => s.delete(id));

/* ---------- Util ---------- */
const bersihNama = (n) => n.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
const mb = (b) => (b / 1048576).toFixed(1) + " MB";
const fmt = (s) => {
  if (!isFinite(s)) return "0:00";
  return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
};

/* ---------- Daftar ---------- */
async function muat() {
  lagu = (await semua()).sort((a, b) => a.nama.localeCompare(b.nama));
  render();
}
function render() {
  const q = $("cari").value.toLowerCase();
  const aktifId = tampil[idx]?.id;
  tampil = lagu.filter((l) => l.nama.toLowerCase().includes(q));
  idx = tampil.findIndex((l) => l.id === aktifId);
  const ul = $("daftar");
  ul.textContent = "";
  tampil.forEach((l, i) => {
    const li = document.createElement("li");
    li.className = "item" + (i === idx ? " aktif" : "");
    li.tabIndex = 0;
    li.innerHTML = '<span class="nama"></span><span class="ukuran"></span><button class="ubah" aria-label="Ubah nama lagu">✎</button><button class="hapus" aria-label="Hapus lagu">✕</button>';
    li.querySelector(".nama").textContent = l.nama;
    li.querySelector(".ukuran").textContent = mb(l.ukuran);
    li.addEventListener("click", () => putar(i));
    li.addEventListener("keydown", (e) => { if (e.key === "Enter") putar(i); });
    li.querySelector(".ubah").addEventListener("click", async (e) => {
      e.stopPropagation();
      const baru = prompt("Ubah nama lagu:", l.nama);
      if (baru === null) return;
      const nama = baru.trim();
      if (!nama || nama === l.nama) return;
      l.nama = nama;
      await ubah(l);
      if (i === idx) {
        $("judul").textContent = nama;
        document.title = nama + " · Musikku";
        setMeta(l);
      }
      await muat();
    });
    li.querySelector(".hapus").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Hapus “" + l.nama + "” dari aplikasi?")) return;
      if (i === idx) { audio.pause(); audio.removeAttribute("src"); $("judul").textContent = "Belum ada lagu diputar"; }
      await hapusDb(l.id);
      await muat();
    });
    ul.appendChild(li);
  });
  $("kosong").hidden = lagu.length > 0;
  if (pemutar.classList.contains("antre")) renderAntrean();
}

/* ---------- Putar ---------- */
function putar(i) {
  if (!tampil[i]) return;
  idx = i;
  const l = tampil[i];
  if (urlAktif) URL.revokeObjectURL(urlAktif);
  urlAktif = URL.createObjectURL(l.blob);
  audio.src = urlAktif;
  audio.play().catch(() => {});
  $("judul").textContent = l.nama;
  document.title = l.nama + " · Musikku";
  tampilCover(l);
  setMeta(l);
  render();
  document.querySelector(".item.aktif")?.scrollIntoView({ block: "nearest" });
}
function berikut(arah) {
  if (!tampil.length) return;
  if (acak && arah > 0) return putar(Math.floor(Math.random() * tampil.length));
  putar((idx + arah + tampil.length) % tampil.length);
}
function toggle() {
  if (!audio.src) return tampil.length && putar(0);
  audio.paused ? audio.play() : audio.pause();
}

/* ---------- Event ---------- */
$("play").onclick = toggle;
$("next").onclick = () => berikut(1);
$("prev").onclick = () => (audio.currentTime > 3 ? (audio.currentTime = 0) : berikut(-1));
$("acak").onclick = (e) => { acak = !acak; e.currentTarget.setAttribute("aria-pressed", acak); };
$("ulang").onclick = (e) => { ulang = !ulang; e.currentTarget.setAttribute("aria-pressed", ulang); };
$("cari").oninput = render;

audio.onplay = () => { $("play").textContent = "⏸"; $("play").setAttribute("aria-label", "Jeda"); $("piringan").classList.add("putar"); };
audio.onpause = () => { $("play").textContent = "▶"; $("play").setAttribute("aria-label", "Putar"); $("piringan").classList.remove("putar"); };
audio.onended = () => (ulang ? (audio.currentTime = 0, audio.play()) : berikut(1));
audio.ontimeupdate = () => {
  if (!audio.duration) return;
  $("seek").value = (audio.currentTime / audio.duration) * 100;
  $("seek").style.setProperty("--p", $("seek").value + "%");
  $("waktuNow").textContent = fmt(audio.currentTime);
  if ("mediaSession" in navigator && navigator.mediaSession.setPositionState) {
    try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: audio.currentTime, playbackRate: audio.playbackRate }); } catch {}
  }
};
audio.onloadedmetadata = () => ($("waktuTotal").textContent = fmt(audio.duration));
$("seek").oninput = (e) => { if (audio.duration) audio.currentTime = (e.target.value / 100) * audio.duration;
  e.target.style.setProperty("--p", e.target.value + "%");
};

$("berkas").onchange = async (e) => {
  const files = [...e.target.files];
  for (let n = 0; n < files.length; n++) {
    $("status").textContent = `Menyimpan ${n + 1} dari ${files.length}…`;
    const f = files[n];
    await simpan({ nama: bersihNama(f.name), ukuran: f.size, blob: f });
  }
  $("status").textContent = files.length ? `${files.length} lagu tersimpan di perangkat` : "";
  e.target.value = "";
  await muat();
  setTimeout(() => ($("status").textContent = ""), 3000);
};

/* Kontrol dari layar kunci / notifikasi / headset */
if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler("play", () => audio.play());
  ms.setActionHandler("pause", () => audio.pause());
  ms.setActionHandler("previoustrack", () => berikut(-1));
  ms.setActionHandler("nexttrack", () => berikut(1));
  ms.setActionHandler("seekto", (d) => { audio.currentTime = d.seekTime; });
}
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  if (e.code === "Space") { e.preventDefault(); toggle(); }
});

/* ---------- Warna tampilan mengikuti foto ---------- */
let tokenTema = 0;
const KUNCI_TEMA = ["--bg", "--surface", "--surface2", "--aksen", "--aksen-teks"];
function rgbKeHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}
async function warnaDominan(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(bmp, 0, 0, 32, 32);
  const d = x.getImageData(0, 0, 32, 32).data;
  let R = 0, G = 0, B = 0, W = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    const terang = (mx + mn) / 510;
    // utamakan piksel yang berwarna dan tidak terlalu gelap/terang
    const w = sat * sat * (1 - Math.abs(terang - 0.5) * 1.6) + 0.001;
    R += r * w; G += g * w; B += b * w; W += w;
  }
  return rgbKeHsl(R / W, G / W, B / W);
}
function setTemaMeta(warna) {
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = warna;
}
async function terapkanTema(blob) {
  const id = ++tokenTema;
  const root = document.documentElement.style;
  if (!blob) {
    KUNCI_TEMA.forEach((k) => root.removeProperty(k));
    setTemaMeta("#16213e");
    return;
  }
  try {
    const [h, s] = await warnaDominan(blob);
    if (id !== tokenTema) return;
    const sb = s < 8 ? 10 : Math.min(s, 45);
    const sa = s < 12 ? 15 : Math.max(55, Math.min(s, 90));
    const bg = `hsl(${h}, ${sb}%, 14%)`;
    root.setProperty("--bg", bg);
    root.setProperty("--surface", `hsl(${h}, ${sb}%, 20%)`);
    root.setProperty("--surface2", `hsl(${h}, ${sb}%, 27%)`);
    root.setProperty("--aksen", `hsl(${h}, ${sa}%, 64%)`);
    root.setProperty("--aksen-teks", `hsl(${h}, 60%, 10%)`);
    setTemaMeta(bg);
  } catch {
    KUNCI_TEMA.forEach((k) => root.removeProperty(k));
  }
}

/* ---------- Foto lagu & logo ---------- */
let urlCover = null;
function tampilCover(l) {
  if (urlCover) { URL.revokeObjectURL(urlCover); urlCover = null; }
  const p = $("piringan");
  if (l && l.cover) {
    urlCover = URL.createObjectURL(l.cover);
    p.style.backgroundImage = `url("${urlCover}")`;
    $("latar").style.backgroundImage = `url("${urlCover}")`;
    p.classList.add("foto");
  } else {
    p.style.backgroundImage = "";
    $("latar").style.backgroundImage = "";
    p.classList.remove("foto");
  }
  terapkanTema(l && l.cover ? l.cover : null);
}
function setMeta(l) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: l.nama, artist: "Musikku",
    artwork: urlCover
      ? [{ src: urlCover, sizes: "500x500", type: "image/jpeg" }]
      : [{ src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }],
  });
}
async function kecilkan(file, maks, tipe) {
  const bmp = await createImageBitmap(file);
  const skala = Math.min(1, maks / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * skala);
  c.height = Math.round(bmp.height * skala);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob(ok, tipe, 0.85));
}
$("piringan").onclick = () => {
  if (!tampil[idx]) {
    $("status").textContent = "Putar satu lagu dulu, lalu ketuk gambar ini";
    setTimeout(() => ($("status").textContent = ""), 3000);
    return;
  }
  $("berkasCover").click();
};
$("berkasCover").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  const l = tampil[idx];
  if (!f || !l) return;
  try {
    l.cover = await kecilkan(f, 500, "image/jpeg");
    await ubah(l);
    tampilCover(l);
    setMeta(l);
  } catch {
    $("status").textContent = "Foto tidak bisa dibaca, coba file lain";
  }
};
try { const lg = localStorage.getItem("logo"); if (lg) $("logoImg").src = lg; } catch {}
$("logoBtn").onclick = () => $("berkasLogo").click();
$("berkasLogo").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const b = await kecilkan(f, 192, "image/png");
    const r = new FileReader();
    r.onload = () => {
      $("logoImg").src = r.result;
      try { localStorage.setItem("logo", r.result); } catch {}
    };
    r.readAsDataURL(b);
  } catch {}
};

/* ---------- Pemutar layar penuh ---------- */
const pemutar = document.querySelector(".player");
function bukaPenuh(buka) {
  if (pemutar.classList.contains("penuh") === buka) return;
  pemutar.classList.toggle("penuh", buka);
  if (!buka) {
    pemutar.classList.remove("antre");
    $("antreBtn").setAttribute("aria-pressed", "false");
  }
  document.body.style.overflow = buka ? "hidden" : "";
  $("besar").textContent = buka ? "⌄" : "⌃";
  $("besar").setAttribute("aria-label", buka ? "Perkecil pemutar" : "Perbesar pemutar");
  if (buka) history.pushState({ penuh: 1 }, "");
}
$("besar").onclick = () => {
  if (pemutar.classList.contains("penuh")) history.back();
  else bukaPenuh(true);
};
document.querySelector(".judul-wrap").onclick = () => bukaPenuh(true);
window.addEventListener("popstate", () => bukaPenuh(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && pemutar.classList.contains("penuh")) history.back();
});

/* ---------- Antrean, volume, tombol foto ---------- */
function renderAntrean() {
  const ul = $("antrean");
  ul.textContent = "";
  if (!tampil.length) return;
  const mulai = idx < 0 ? 0 : idx + 1;
  const n = idx < 0 ? tampil.length : tampil.length - 1;
  for (let k = 0; k < n; k++) {
    const i = (mulai + k) % tampil.length;
    const li = document.createElement("li");
    li.textContent = tampil[i].nama;
    li.tabIndex = 0;
    li.onclick = () => putar(i);
    li.onkeydown = (e) => { if (e.key === "Enter") putar(i); };
    ul.appendChild(li);
  }
}
$("antreBtn").onclick = (e) => {
  const on = pemutar.classList.toggle("antre");
  e.currentTarget.setAttribute("aria-pressed", on);
  if (on) renderAntrean();
};
$("gantiFoto").onclick = () => $("piringan").onclick();
const volBisa = (() => {
  const v = audio.volume;
  audio.volume = 0.5;
  const ok = audio.volume === 0.5;
  audio.volume = v;
  return ok;
})();
if (!volBisa) document.querySelector(".vol").classList.add("tak"); // iPhone: volume diatur tombol fisik
$("vol").style.setProperty("--p", "100%");
$("vol").oninput = (e) => {
  audio.volume = +e.target.value;
  e.target.style.setProperty("--p", e.target.value * 100 + "%");
};

/* ---------- Offline ---------- */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
if (navigator.storage?.persist) navigator.storage.persist(); // minta agar data tidak dihapus otomatis
muat();
