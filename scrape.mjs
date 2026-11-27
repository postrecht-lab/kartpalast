// Liest die Auslastung "Grand Prix 30" im Kartpalast München (SMS-Timing Online-Buchung)
// für heute + 7 Tage und schreibt docs/data.json. Es wird nichts gebucht:
// nur der Termin-Dialog wird geöffnet und das Datum gewechselt.
import { chromium } from "playwright";
import fs from "node:fs";

const URL = "https://booking.sms-timing.com/teamsportkartpalast/book/product-list";
const PRODUCT = "Grand Prix 30";
const DAYS = 8;
const OUT = "docs/data.json";
const MON = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

const berlin = (d = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
};

const cap = {}, capT = {};
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: "de-DE", timezoneId: "Europe/Berlin", viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const DEBUG = !!process.env.KART_DEBUG;
page.on("request", (q) => { if (DEBUG && /sms-timing\.com\/api/.test(q.url())) console.log("REQ", q.method(), q.url().replace(/^https:\/\/[^/]+/, ""), (q.postData() || "").slice(0, 120)); });
page.on("response", async (r) => {
  const u = r.url();
  if (DEBUG && /sms-timing\.com\/api/.test(u)) console.log("RES", r.status(), u.replace(/^https:\/\/[^/]+/, ""));
  if (!/dayplanner/.test(u)) return;
  try {
    const d = await r.json();
    const date = decodeURIComponent((u.match(/date=([^&]+)/) || [])[1] || "").slice(0, 10);
    if (!date) return;
    cap[date] = (d.proposals || []).map(p => { const k = p.blocks[0].block; return [k.start.slice(11, 16), String(k.resourceId), k.capacity, k.freeSpots]; });
    capT[date] = Date.now();
  } catch {}
});

await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
// Cookie-Hinweis schließen (datensparsam: ablehnen / nur notwendige)
async function dismissConsent() {
  const rx = /^(alle ablehnen|ablehnen|nur notwendige|nur essenzielle|notwendige cookies|decline|reject all|reject)/i;
  for (const f of page.frames()) {
    try {
      const btns = f.locator("button, a[role=button], [role=button]");
      const n = await btns.count();
      for (let i = 0; i < n; i++) {
        const b = btns.nth(i);
        const t = ((await b.innerText().catch(() => "")) || "").trim();
        if (rx.test(t) && await b.isVisible().catch(() => false)) { await b.click({ timeout: 3000 }).catch(() => {}); if (DEBUG) console.log("CONSENT", JSON.stringify(t)); return true; }
      }
    } catch {}
  }
  return false;
}
await page.waitForTimeout(1500);
await dismissConsent();
const found = await page.waitForFunction((prod) => {
  const a = [...document.querySelectorAll("a")].find(a => /Buche jetzt/.test(a.textContent) && a.closest("sms-product-item")?.querySelector("h1,h2,h3,h4")?.textContent.trim() === prod);
  if (a) { a.click(); return true; }
  return false;
}, PRODUCT, { timeout: 30000 }).catch(() => null);
if (!found) { console.error("Produkt nicht gefunden"); await browser.close(); process.exit(1); }
await page.waitForTimeout(2500);

const keyOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const [y, m, dd] = berlin().slice(0, 10).split("-").map(Number);
const log = [];
for (let i = 0; i < DAYS; i++) {
  const d = new Date(y, m - 1, dd + i);
  const key = keyOf(d), label = `${d.getDate()}. ${MON[d.getMonth()]} ${d.getFullYear()}`;
  const t0 = Date.now();
  let res = "nicht gefunden";
  try {
    const cal = page.locator(".mat-calendar");
    if (!(await cal.isVisible().catch(() => false))) {
      await page.locator('sms-product-booker-popup button[aria-label="Open calendar"]').click({ timeout: 10000 });
      await cal.waitFor({ state: "visible", timeout: 10000 });
    }
    for (let k = 0; k < 3; k++) {
      const btn = page.locator(`.mat-calendar button[aria-label="${label}"]`);
      if (await btn.count()) {
        if ((await btn.getAttribute("aria-disabled")) === "true") { await page.keyboard.press("Escape"); res = "gesperrt"; break; }
        await btn.click({ timeout: 10000 }); res = "ok"; break;
      }
      await page.locator(".mat-calendar-next-button").click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
  } catch (e) {
    const msg = String(e.message || e);
    res = "fehler: " + ((msg.match(/<[^>]+> (?:from <[^>]+> subtree )?intercepts pointer events/) || [msg.split("\n")[0]])[0]).slice(0, 160);
    await dismissConsent();
  }
  if (res === "ok") { for (let w = 0; w < 40 && !(capT[key] >= t0); w++) await page.waitForTimeout(250); }
  log.push(`${key}:${res}${cap[key] ? "/" + cap[key].length : ""}`);
  if (DEBUG) { console.log("TAG", key, label, res, Object.keys(cap).join(",")); await page.screenshot({ path: `debug-${i}.png` }); }
}
await browser.close();
console.log(log.join(" "));

// --- Zusammenführen mit bisherigen Daten ---
const runAt = berlin(), today = runAt.slice(0, 10);
let old = { slots: {} };
try { old = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch {}
const slots = {};
for (const [k, v] of Object.entries(old.slots || {})) if (k >= today) slots[k] = v;
let n = 0;
for (const [date, rows] of Object.entries(cap)) {
  if (date < today) continue;
  const day = slots[date] = slots[date] || {};
  for (const [t, id, c, free] of rows) { day[`${t}|${id}`] = [c, free, runAt]; n++; }
}
if (!n) { console.error("Keine Daten erhalten – data.json bleibt unverändert"); process.exit(1); }
const notes = {};
for (const [k, v] of Object.entries(old.notes || {})) if (k.slice(0, 10) >= today) notes[k] = v;
const out = { updated: runAt, product: PRODUCT,
  tracks: old.tracks || { "282567": "Raceway 3", "29082": "Raceway 2" },
  guessed: old.guessed || [], notes, slots };
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`OK: ${n} Läufe, ${Object.keys(slots).length} Tage, Stand ${runAt}`);
