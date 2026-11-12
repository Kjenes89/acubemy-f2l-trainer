// Logging av hvert forsøk til Vegards Cloudflare Worker, som skriver til et privat GitHub-repo.
// Sandkassen i acubemy blokkerer lagring i nettleseren, men tillater fetch (testet 11.11.).
// Postene samles og sendes i bunter; feiler sendingen, prøves det igjen ved neste sending.
// Workeren lagrer bare med riktig kode (LOG_PIN, en hemmelighet i Cloudflare). Koden står aldri i koden her:
// Vegard skriver den inn ved oppstart, og den finnes bare i minnet så lenge pluginen er åpen.

export const LOG_URL = "https://pll-vk-7q3.vegard-kjenes.workers.dev/api/log";

const SESSION = new Date().toISOString().replace(/[:.]/g, "-") + "-" + Math.random().toString(36).slice(2, 6);
let buffer = [];
let sending = false;
let status = "venter på kode";
let pin = null;
const listeners = [];

export function onStatus(fn) { listeners.push(fn); fn(status, buffer.length); }
function setStatus(s) { status = s; listeners.forEach((fn) => fn(status, buffer.length)); }

export function log(rec) {
  buffer.push({ ...rec, session: SESSION, t: new Date().toISOString() });
  if (buffer.length > 2000) buffer = buffer.slice(-2000); // ved langvarig sendefeil: behold de nyeste
  setStatus(status);
  if (buffer.length >= 10) flush();
}

/** Sjekk koden mot Workeren. Riktig kode brukes for resten av økta, og det som venter sendes. */
export async function setPin(code) {
  try {
    const r = await fetch(LOG_URL.replace(/\/api\/log$/, "/api/pin"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: code }) });
    if (r.ok) { pin = code; setStatus("kode godkjent"); flush(); return { ok: true }; }
    let m = ""; try { m = (await r.json()).error || ""; } catch {}
    return { ok: false, error: m || "HTTP " + r.status };
  } catch (e) { return { ok: false, error: "ingen kontakt med loggen" }; }
}
export const hasPin = () => !!pin;

export async function flush() {
  if (!LOG_URL || sending || !buffer.length) return;
  if (!pin) { setStatus("venter på kode"); return; }
  sending = true;
  const batch = buffer.slice();
  try {
    const r = await fetch(LOG_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin, records: batch }),
      keepalive: true,
    });
    let j = {}; try { j = await r.json(); } catch {}
    if (r.status === 401) { pin = null; throw new Error("feil kode – skriv den inn på nytt"); }
    if (!r.ok) throw new Error("HTTP " + r.status + (j.error ? " – " + j.error : ""));
    buffer = buffer.slice(batch.length);
    setStatus(j.rejected ? `lagret (${j.rejected} avvist av Workeren)` : "lagret");
  } catch (e) {
    setStatus("feil: " + e.message);
  } finally {
    sending = false;
  }
}

setInterval(flush, 30000);
if (typeof addEventListener === "function") addEventListener("pagehide", flush);
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
