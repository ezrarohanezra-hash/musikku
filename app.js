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
    li.innerHTML = '<span class="nama"></span><span class="ukuran"></span><button class="hapus" aria-label="Hapus lagu">✕</button>';
    li.querySelector(".nama").textContent = l.nama;
    li.querySelector(".ukuran").textContent = mb(l.ukuran);
    li.addEventListener("click", () => putar(i));
    li.addEventListener("keydown", (e) => { if (e.key === "Enter") putar(i); });
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
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: l.nama, artist: "Musikku",
      artwork: [{ src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }],
    });
  }
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
  $("waktuNow").textContent = fmt(audio.currentTime);
  if ("mediaSession" in navigator && navigator.mediaSession.setPositionState) {
    try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: audio.currentTime, playbackRate: audio.playbackRate }); } catch {}
  }
};
audio.onloadedmetadata = () => ($("waktuTotal").textContent = fmt(audio.duration));
$("seek").oninput = (e) => { if (audio.duration) audio.currentTime = (e.target.value / 100) * audio.duration; };

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

/* ---------- Offline ---------- */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
if (navigator.storage?.persist) navigator.storage.persist(); // minta agar data tidak dihapus otomatis
muat();
