// Logging av hvert forsøk til Vegards Cloudflare Worker, som skriver til et privat GitHub-repo.
// Sandkassen i acubemy blokkerer lagring i nettleseren, men tillater fetch (testet 11.11.).
// Postene samles og sendes i bunter; feiler sendingen, prøves det igjen ved neste sending.

export const LOG_URL = "https://pll-vk-7q3.vegard-kjenes.workers.dev/api/log";

const SESSION = new Date().toISOString().replace(/[:.]/g, "-") + "-" + Math.random().toString(36).slice(2, 6);
let buffer = [];
let sending = false;
let status = LOG_URL ? "klar" : "ikke satt opp";
const listeners = [];

export function onStatus(fn) { listeners.push(fn); fn(status, buffer.length); }
function setStatus(s) { status = s; listeners.forEach((fn) => fn(status, buffer.length)); }

export function log(rec) {
  buffer.push({ ...rec, session: SESSION, t: new Date().toISOString() });
  if (buffer.length > 2000) buffer = buffer.slice(-2000); // ved langvarig sendefeil: behold de nyeste
  setStatus(status);
  if (buffer.length >= 10) flush();
}

export async function flush() {
  if (!LOG_URL || sending || !buffer.length) return;
  sending = true;
  const batch = buffer.slice();
  try {
    const r = await fetch(LOG_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records: batch }),
      keepalive: true,
    });
    if (!r.ok) { let m = ""; try { m = (await r.json()).error || ""; } catch {} throw new Error("HTTP " + r.status + (m ? " – " + m : "")); }
    buffer = buffer.slice(batch.length);
    setStatus("lagret");
  } catch (e) {
    setStatus("feil: " + e.message);
  } finally {
    sending = false;
  }
}

setInterval(flush, 30000);
addEventListener("pagehide", flush);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
