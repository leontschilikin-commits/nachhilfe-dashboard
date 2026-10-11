"use strict";

// ---------- Hilfen ----------
const $ = (sel, el = document) => el.querySelector(sel);
const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const SUBJECTS = ["Rechnungswesen", "BWL", "Mathematik"];
const pad = n => String(n).padStart(2, "0");
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const euro = v => new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR", minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }).format(v);
const dayTime = d => new Intl.DateTimeFormat("de-AT", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
const percent = v => new Intl.NumberFormat("de-AT", { style: "percent", maximumFractionDigits: 0 }).format(v);
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const sum = (arr, f) => arr.reduce((t, x) => t + f(x), 0);

// ---------- Speicher (nur lokal im Browser) ----------
const KEYS = { sessions: "nd.sessions", gs: "nd.gostudent" };
function load(key) {
  try { const v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v : []; } catch { return []; }
}
let sessions = load(KEYS.sessions); // {id, studentName, subject, hourlyRate, date(ISO), isPaid}
let goStudent = load(KEYS.gs);      // {id, month(1-12), year, amount}
function persist() {
  try {
    localStorage.setItem(KEYS.sessions, JSON.stringify(sessions));
    localStorage.setItem(KEYS.gs, JSON.stringify(goStudent));
  } catch { alert("Speichern im Browser nicht möglich (privates Fenster oder gesperrter Speicher)."); }
}
const dateOf = s => new Date(s.date);
const gsDate = g => new Date(g.year, g.month - 1, 15);
const openAmount = () => sum(sessions.filter(s => dateOf(s) < new Date() && !s.isPaid), s => s.hourlyRate);

// ---------- Navigation ----------
function showTab() {
  const tab = location.hash === "#auswertung" ? "auswertung" : "einheiten";
  document.querySelectorAll("nav a").forEach(a => a.classList.toggle("active", a.dataset.tab === tab));
  $("#view-einheiten").hidden = tab !== "einheiten";
  $("#view-auswertung").hidden = tab !== "auswertung";
  if (tab === "auswertung") renderAnalytics(); else renderSessions();
}
window.addEventListener("hashchange", showTab);

// ======================================================================
// Einheiten
// ======================================================================
const form = { editingId: null, day: new Date(), hour: 16, minute: 0, calMonth: new Date() };

function tile(icon, title, value, detail) {
  return `<div class="tile"><div class="ti">${icon}</div><div style="min-width:0"><div class="tl">${title}</div><div class="tv">${value}</div>${detail ? `<div class="td">${detail}</div>` : ""}</div></div>`;
}

function buildSessionsView() {
  $("#view-einheiten").innerHTML = `
    <div class="tiles" id="s-tiles"></div>
    <div class="card" id="form-card">
      <h2><span class="ico" id="form-ico">＋</span><span id="form-title">Neue Einheit</span></h2>
      <div class="form-grid">
        <div class="fields">
          <div class="field"><label for="f-name">Name des Schülers</label><input type="text" id="f-name" autocomplete="off"></div>
          <div class="field"><label for="f-subject">Fach</label><select id="f-subject">${SUBJECTS.map(s => `<option>${s}</option>`).join("")}</select></div>
          <div class="field"><label for="f-rate">Stundensatz</label><div class="rate"><input type="text" id="f-rate" inputmode="decimal" autocomplete="off"><span>€ / Stunde</span></div></div>
          <button class="btn" id="f-save" type="button" disabled>Speichern</button>
          <button class="link" id="f-cancel" type="button" hidden>Abbrechen</button>
        </div>
        <div class="field"><label>Termin</label>
          <div class="picker">
            <div id="cal"></div><hr>
            <div class="wheels"><div class="wheel" id="w-hour"></div><span class="colon">:</span><div class="wheel" id="w-min"></div></div>
          </div>
        </div>
      </div>
    </div>
    <div class="card"><div class="list-head"><h2><span class="ico">☰</span>Geplante Einheiten</h2></div><div id="s-list"></div></div>`;

  buildWheel($("#w-hour"), 24, v => { form.hour = v; });
  buildWheel($("#w-min"), 60, v => { form.minute = v; });
  renderCalendar();

  const name = $("#f-name"), rate = $("#f-rate");
  name.addEventListener("input", () => { name.value = name.value.replace(/[^\p{L}\s]/gu, ""); validate(); });
  rate.addEventListener("input", () => { rate.value = rate.value.replace(/[^0-9.,]/g, ""); validate(); });
  $("#f-save").addEventListener("click", saveSession);
  $("#f-cancel").addEventListener("click", resetForm);
  $("#form-card").addEventListener("keydown", e => { if (e.key === "Enter" && !$("#f-save").disabled && e.target.tagName === "INPUT") saveSession(); });
  $("#s-list").addEventListener("click", onListClick);
  resetForm();
}

const parseRate = () => { const v = parseFloat($("#f-rate").value.replace(",", ".")); return v > 0 ? v : null; };
function validate() { $("#f-save").disabled = !($("#f-name").value.trim() && parseRate() !== null); }

// --- Kalender ---
function renderCalendar() {
  const m = form.calMonth, first = new Date(m.getFullYear(), m.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // Montag zuerst
  const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const today = new Date();
  let cells = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map(w => `<div class="wd">${w}</div>`).join("");
  cells += "<div></div>".repeat(offset);
  for (let d = 1; d <= days; d++) {
    const date = new Date(m.getFullYear(), m.getMonth(), d);
    const cls = ["day", sameDay(date, form.day) ? "sel" : "", sameDay(date, today) ? "today" : ""].join(" ");
    cells += `<div class="${cls}" data-d="${d}"><span>${d}</span></div>`;
  }
  $("#cal").innerHTML = `<div class="cal-head"><span>${MONTHS[m.getMonth()]} ${m.getFullYear()}</span><span><button type="button" data-shift="-1" aria-label="Voriger Monat">‹</button><button type="button" data-shift="1" aria-label="Nächster Monat">›</button></span></div><div class="cal-grid">${cells}</div>`;
}
document.addEventListener("click", e => {
  const cal = e.target.closest("#cal");
  if (!cal) return;
  const shift = e.target.closest("[data-shift]"), day = e.target.closest(".day");
  if (shift) { form.calMonth = new Date(form.calMonth.getFullYear(), form.calMonth.getMonth() + Number(shift.dataset.shift), 1); renderCalendar(); }
  if (day) { form.day = new Date(form.calMonth.getFullYear(), form.calMonth.getMonth(), Number(day.dataset.d)); renderCalendar(); }
});

// --- Uhrzeit-Walzen (natives Scrollen mit Einrasten) ---
const ROW = 34;
function buildWheel(el, count, onChange) {
  el.innerHTML = `<div class="pad"></div>${Array.from({ length: count }, (_, i) => `<div class="item" data-v="${i}">${pad(i)}</div>`).join("")}<div class="pad"></div>`;
  let current = -1;
  el.addEventListener("scroll", () => {
    const v = Math.max(0, Math.min(count - 1, Math.round(el.scrollTop / ROW)));
    if (v === current) return;
    current = v;
    el.querySelectorAll(".item").forEach(it => it.classList.toggle("on", Number(it.dataset.v) === v));
    onChange(v);
  }, { passive: true });
  el.addEventListener("click", e => {
    const it = e.target.closest(".item");
    if (it) el.scrollTo({ top: Number(it.dataset.v) * ROW, behavior: "smooth" });
  });
}
function setWheel(el, value) {
  el.scrollTop = value * ROW;
  el.querySelectorAll(".item").forEach(it => it.classList.toggle("on", Number(it.dataset.v) === value));
}

// --- Formular zurücksetzen / bearbeiten / speichern ---
function resetForm() {
  form.editingId = null;
  form.day = new Date(); form.calMonth = new Date(form.day.getFullYear(), form.day.getMonth(), 1);
  $("#f-name").value = ""; $("#f-rate").value = "";
  $("#f-subject").value = SUBJECTS[0];
  $("#form-title").textContent = "Neue Einheit"; $("#form-ico").textContent = "＋";
  $("#f-save").textContent = "Speichern"; $("#f-cancel").hidden = true;
  renderCalendar();
  form.hour = 16; form.minute = 0;
  requestAnimationFrame(() => { setWheel($("#w-hour"), 16); setWheel($("#w-min"), 0); });
  validate();
}
function startEditing(s) {
  const d = dateOf(s);
  form.editingId = s.id; form.day = d; form.calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  form.hour = d.getHours(); form.minute = d.getMinutes();
  $("#f-name").value = s.studentName; $("#f-subject").value = s.subject;
  $("#f-rate").value = String(s.hourlyRate).replace(".", ",");
  $("#form-title").textContent = "Einheit bearbeiten"; $("#form-ico").textContent = "✎";
  $("#f-save").textContent = "Änderungen speichern"; $("#f-cancel").hidden = false;
  renderCalendar(); setWheel($("#w-hour"), form.hour); setWheel($("#w-min"), form.minute);
  validate(); $("#f-name").focus(); $("#form-card").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function saveSession() {
  const rate = parseRate(), name = $("#f-name").value.trim();
  if (!name || rate === null) return;
  const date = new Date(form.day.getFullYear(), form.day.getMonth(), form.day.getDate(), form.hour, form.minute).toISOString();
  const existing = sessions.find(s => s.id === form.editingId);
  if (existing) Object.assign(existing, { studentName: name, subject: $("#f-subject").value, hourlyRate: rate, date });
  else sessions.push({ id: uid(), studentName: name, subject: $("#f-subject").value, hourlyRate: rate, date, isPaid: false });
  persist(); resetForm(); renderSessionLists();
}

// --- Liste ---
function onListClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const s = sessions.find(x => x.id === btn.dataset.id);
  if (!s) return;
  if (btn.dataset.act === "paid") { s.isPaid = !s.isPaid; persist(); renderSessionLists(); }
  if (btn.dataset.act === "edit") startEditing(s);
  if (btn.dataset.act === "del") {
    sessions = sessions.filter(x => x.id !== s.id);
    if (form.editingId === s.id) resetForm();
    persist(); renderSessionLists();
  }
}
function rowHtml(s, past) {
  const open = past && !s.isPaid;
  return `<div class="row ${past && s.isPaid ? "done" : ""}">
    <button class="check ${s.isPaid ? "paid" : ""}" data-act="paid" data-id="${s.id}" title="${s.isPaid ? "Als offen markieren" : "Als bezahlt markieren"}">${s.isPaid ? "✓" : ""}</button>
    <div class="main"><div class="name">${esc(s.studentName)}</div><div class="meta">${esc(s.subject)} • ${dayTime(dateOf(s))} Uhr</div></div>
    ${open ? '<span class="badge">offen</span>' : ""}
    <span class="amount">${euro(s.hourlyRate)}</span>
    <button class="icon-btn" data-act="edit" data-id="${s.id}" title="Einheit bearbeiten">✎</button>
    <button class="icon-btn" data-act="del" data-id="${s.id}" title="Einheit löschen">🗑</button>
  </div>`;
}
function renderSessionLists() {
  const now = new Date();
  const upcoming = sessions.filter(s => dateOf(s) >= now).sort((a, b) => dateOf(a) - dateOf(b));
  const past = sessions.filter(s => dateOf(s) < now).sort((a, b) => dateOf(b) - dateOf(a));
  const month = sum(sessions.filter(s => dateOf(s).getMonth() === now.getMonth() && dateOf(s).getFullYear() === now.getFullYear()), s => s.hourlyRate)
    + sum(goStudent.filter(g => g.month === now.getMonth() + 1 && g.year === now.getFullYear()), g => g.amount);

  $("#s-tiles").innerHTML =
    tile("🕒", "Nächste Einheit", upcoming[0] ? dayTime(dateOf(upcoming[0])) : "–") +
    tile("↗", "Geplant", euro(sum(upcoming, s => s.hourlyRate)), `${upcoming.length} Einheiten`) +
    tile("⏳", "Offen", euro(openAmount()), "noch nicht bezahlt") +
    tile("€", "Dieser Monat", euro(month));

  $("#s-list").innerHTML = sessions.length === 0
    ? '<div class="empty">Keine Einheiten – trage oben deine erste ein.</div>'
    : upcoming.map(s => rowHtml(s, false)).join("") + (past.length ? '<div class="sub">Vergangen</div>' + past.map(s => rowHtml(s, true)).join("") : "");
}
function renderSessions() {
  if (!$("#s-tiles")) buildSessionsView();
  renderSessionLists();
}

// ======================================================================
// Auswertung
// ======================================================================
const PERIODS = { month: "Dieser Monat", year: "Dieses Jahr", all: "Gesamt" };
const RANGES = { days: "Tage", months: "Monate", years: "Jahre" };
const an = { period: "month", range: "months", gsMonth: new Date().getMonth() + 1, gsYear: new Date().getFullYear(), gsAmount: "" };

function interval(period, offset = 0) {
  const n = new Date();
  if (period === "month") return [new Date(n.getFullYear(), n.getMonth() + offset, 1), new Date(n.getFullYear(), n.getMonth() + offset + 1, 1)];
  if (period === "year") return [new Date(n.getFullYear() + offset, 0, 1), new Date(n.getFullYear() + offset + 1, 0, 1)];
  return null;
}
const inRange = (d, iv) => !iv || (d >= iv[0] && d < iv[1]);
const revenueIn = iv => sum(sessions.filter(s => inRange(dateOf(s), iv)), s => s.hourlyRate) + sum(goStudent.filter(g => inRange(gsDate(g), iv)), g => g.amount);

function seg(name, options, current) {
  return `<div class="seg" data-seg="${name}">${Object.entries(options).map(([k, l]) => `<button type="button" data-k="${k}" class="${k === current ? "on" : ""}">${l}</button>`).join("")}</div>`;
}

function timeline() {
  const fmt = {
    days: [d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, d => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`],
    months: [d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, d => `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`],
    years: [d => `${d.getFullYear()}`, d => `${d.getFullYear()}`]
  }[an.range];
  const map = new Map();
  const add = (d, amount) => { const k = fmt[0](d); const e = map.get(k) || { label: fmt[1](d), amount: 0, key: k }; e.amount += amount; map.set(k, e); };
  sessions.forEach(s => add(dateOf(s), s.hourlyRate));
  goStudent.forEach(g => add(gsDate(g), g.amount));
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function lineChart(points) {
  const W = 760, H = 240, L = 54, R = 16, T = 12, B = 30;
  const max = Math.max(...points.map(p => p.amount), 1);
  const step = Math.pow(10, Math.floor(Math.log10(max))), nice = Math.ceil(max / step) * step;
  const ticks = 4;
  const x = i => points.length === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (points.length - 1);
  const y = v => T + (H - T - B) * (1 - v / nice);
  let path = `M${x(0)},${y(points[0].amount)}`;
  for (let i = 1; i < points.length; i++) {
    const mx = (x(i - 1) + x(i)) / 2;
    path += ` C${mx},${y(points[i - 1].amount)} ${mx},${y(points[i].amount)} ${x(i)},${y(points[i].amount)}`;
  }
  const area = `${path} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const grid = Array.from({ length: ticks + 1 }, (_, i) => {
    const v = nice * i / ticks;
    return `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)} €</text>`;
  }).join("");
  const every = Math.ceil(points.length / 10);
  const labels = points.map((p, i) => i % every === 0 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(p.label)}</text>` : "").join("");
  const dots = points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.amount)}" r="4" fill="var(--accent)"><title>${esc(p.label)}: ${euro(p.amount)}</title></circle>`).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Einnahmenentwicklung">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".3"/><stop offset="1" stop-color="var(--accent)" stop-opacity=".02"/></linearGradient></defs>
    ${grid}<path d="${area}" fill="url(#g)"/><path d="${path}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round"/>${dots}${labels}</svg>`;
}

function donut(items, total) {
  const R = 70, C = 2 * Math.PI * R, ramp = [1, .75, .55, .4, .28];
  let offset = 0;
  const arcs = items.map((it, i) => {
    const len = C * it.revenue / total, gap = items.length > 1 ? 2 : 0;
    const el = `<circle r="${R}" cx="100" cy="100" fill="none" stroke="var(--accent)" stroke-opacity="${ramp[i % ramp.length]}" stroke-width="30"
      stroke-dasharray="${Math.max(len - gap, 0)} ${C - Math.max(len - gap, 0)}" stroke-dashoffset="${-offset}" transform="rotate(-90 100 100)"><title>${esc(it.name)}: ${euro(it.revenue)}</title></circle>`;
    offset += len; return el;
  }).join("");
  return `<svg viewBox="0 0 200 200" role="img" aria-label="Umsatzverteilung">${arcs}</svg>`;
}

function renderAnalytics() {
  const iv = interval(an.period);
  const fs = sessions.filter(s => inRange(dateOf(s), iv)), fg = goStudent.filter(g => inRange(gsDate(g), iv));
  const priv = sum(fs, s => s.hourlyRate), gsSum = sum(fg, g => g.amount), total = priv + gsSum;

  let detail = "";
  if (an.period !== "all") {
    const prev = revenueIn(interval(an.period, -1)), label = an.period === "month" ? "zum Vormonat" : "zum Vorjahr";
    detail = prev > 0 ? `${total >= prev ? "▲" : "▼"} ${percent(Math.abs((total - prev) / prev))} ${label}` : `kein Vergleich ${label}`;
  }

  const byStudent = new Map();
  fs.forEach(s => byStudent.set(s.studentName, (byStudent.get(s.studentName) || 0) + s.hourlyRate));
  const items = [...byStudent].map(([name, revenue]) => ({ name, revenue }));
  if (gsSum > 0) items.push({ name: "GoStudent", revenue: gsSum });
  items.sort((a, b) => b.revenue - a.revenue);
  const ramp = [1, .75, .55, .4, .28];

  const points = timeline(), years = Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - 2 + i);
  const view = $("#view-auswertung");
  view.innerHTML = `
    ${seg("period", PERIODS, an.period)}
    <div class="tiles">
      ${tile("€", "Umsatz", euro(total), detail)}${tile("👥", "Privatschüler", euro(priv))}${tile("💼", "GoStudent", euro(gsSum))}${tile("⏳", "Offen", euro(openAmount()), "noch nicht bezahlt")}
    </div>
    <div class="card"><h2><span class="ico">📈</span>Einnahmenentwicklung</h2>${seg("range", RANGES, an.range)}
      ${points.length ? lineChart(points) : '<div class="empty">Keine Daten</div>'}</div>
    <div class="card"><h2><span class="ico">💼</span>GoStudent-Monatseinnahmen</h2>
      <div class="gs-form">
        <select id="gs-month">${MONTHS.map((m, i) => `<option value="${i + 1}" ${i + 1 === an.gsMonth ? "selected" : ""}>${m}</option>`).join("")}</select>
        <select id="gs-year">${years.map(y => `<option ${y === an.gsYear ? "selected" : ""}>${y}</option>`).join("")}</select>
        <input type="text" id="gs-amount" inputmode="decimal" placeholder="Betrag (€)" value="${esc(an.gsAmount)}" autocomplete="off">
        <button class="btn" id="gs-add" type="button">Hinzufügen</button>
      </div>
      <div class="chips">${[...goStudent].sort((a, b) => gsDate(a) - gsDate(b)).map(g => `<span class="chip"><b>${MONTHS[g.month - 1]} ${g.year}:</b> ${euro(g.amount)}<button data-gs-del="${g.id}" title="Entfernen">✕</button></span>`).join("")}</div>
    </div>
    <div class="card"><h2><span class="ico">◔</span>Umsatzverteilung · ${PERIODS[an.period]}</h2>
      ${items.length ? `<div class="dist">${donut(items, total)}<table>${items.map((it, i) => `<tr><td><span class="dot" style="background:var(--accent);opacity:${ramp[i % ramp.length]}"></span>${esc(it.name)}</td><td class="r">${euro(it.revenue)}</td><td class="r p">${percent(it.revenue / total)}</td></tr>`).join("")}</table></div>` : '<div class="empty">Keine Daten</div>'}
    </div>`;

  const amount = $("#gs-amount"), add = $("#gs-add");
  const parse = () => { const v = parseFloat(amount.value.replace(",", ".")); return Number.isFinite(v) ? v : null; };
  const sync = () => { add.disabled = parse() === null; };
  amount.addEventListener("input", () => { amount.value = amount.value.replace(/[^0-9.,]/g, ""); an.gsAmount = amount.value; sync(); });
  amount.addEventListener("keydown", e => { if (e.key === "Enter") add.click(); });
  $("#gs-month").addEventListener("change", e => { an.gsMonth = Number(e.target.value); });
  $("#gs-year").addEventListener("change", e => { an.gsYear = Number(e.target.value); });
  add.addEventListener("click", () => {
    const v = parse(); if (v === null) return;
    const ex = goStudent.find(g => g.month === an.gsMonth && g.year === an.gsYear);
    if (ex) ex.amount = v; else goStudent.push({ id: uid(), month: an.gsMonth, year: an.gsYear, amount: v });
    an.gsAmount = ""; persist(); renderAnalytics();
  });
  sync();
}
$("#view-auswertung").addEventListener("click", e => {
  const segBtn = e.target.closest("[data-seg] button");
  if (segBtn) { an[segBtn.parentElement.dataset.seg] = segBtn.dataset.k; renderAnalytics(); return; }
  const del = e.target.closest("[data-gs-del]");
  if (del) { goStudent = goStudent.filter(g => g.id !== del.dataset.gsDel); persist(); renderAnalytics(); }
});

// ======================================================================
// Export / Import
// ======================================================================
$("#export-btn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ sessions, goStudent }, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `nachhilfe-daten-${new Date().toISOString().slice(0, 10)}.json` });
  a.click(); URL.revokeObjectURL(a.href);
});
$("#import-btn").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", async e => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.sessions) || !Array.isArray(data.goStudent)) throw new Error("format");
    if (!confirm(`${data.sessions.length} Einheiten und ${data.goStudent.length} GoStudent-Einträge importieren?\nDie aktuellen Daten in diesem Browser werden ersetzt.`)) return;
    sessions = data.sessions; goStudent = data.goStudent; persist(); showTab();
  } catch { alert("Die Datei konnte nicht gelesen werden. Erwartet wird ein Export aus dieser App."); }
});

// Einheiten, die sich ändern, sobald die Zeit weiterläuft (z. B. "offen"), regelmäßig neu zeichnen
setInterval(() => { if (!$("#view-einheiten").hidden && $("#s-tiles")) renderSessionLists(); }, 60000);
showTab();
