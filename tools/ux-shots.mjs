// Mobile UX screenshot harness — renders key screens at 390x844 for visual review.
// Not part of CI. Usage: node tools/ux-shots.mjs  (outputs PNGs to %TEMP%/nutrio-ux-shots)
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.UX_PORT || 8791);
const DEBUG_PORT = Number(process.env.UX_DEBUG_PORT || 9242);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const outDir = path.join(os.tmpdir(), "nutrio-ux-shots");
fs.mkdirSync(outDir, { recursive: true });

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8", ".png": "image/png",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, ORIGIN).pathname);
  if (rel === "/") rel = "/index.html";
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("not found"); return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

function browserPath() {
  const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
  const which = (p) => { const r = spawnSync(process.platform === "win32" ? "where.exe" : "which", [p], { encoding: "utf8" }); return r.status === 0 ? r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : []; };
  const cands = [process.env.CHROME_PATH, ...which("chrome"), ...which("chrome.exe"), ...which("msedge"), ...which("msedge.exe")];
  for (const root of roots) {
    cands.push(path.join(root, "Google", "Chrome", "Application", "chrome.exe"));
    cands.push(path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"));
  }
  return cands.filter(Boolean).find((c) => fs.existsSync(c));
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => { let b = ""; res.setEncoding("utf8"); res.on("data", (c) => (b += c)); res.on("end", () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); }).on("error", reject);
});

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error("ws failed")); });
  return { send: (method, params = {}, sessionId = null) => { const id = ++seq; ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params })); return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej })); }, close: () => ws.close() };
}

async function main() {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const chromePath = browserPath();
  if (!chromePath) throw new Error("Chrome/Edge not found; set CHROME_PATH");
  const userDataDir = path.join(os.tmpdir(), `nutrio-ux-${Date.now()}`);
  const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--no-proxy-server", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userDataDir}`, "--window-size=390,844", "about:blank"], { stdio: "ignore" });

  try {
    let version;
    for (let i = 0; i < 60; i++) { try { version = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`); break; } catch { await delay(200); } }
    if (!version) throw new Error("DevTools did not start");
    const cdp = await connect(version.webSocketDebuggerUrl);
    const target = await cdp.send("Target.createTarget", { url: "about:blank" });
    const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    const sid = attached.sessionId;
    const send = (m, p = {}) => cdp.send(m, p, sid);
    const evalJs = (expression, awaitPromise = true) => send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });

    await send("Runtime.enable");
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send("Page.navigate", { url: ORIGIN + "/" });
    await delay(2500);

    // wait for home
    await evalJs(`(async()=>{for(let i=0;i<80;i++){if(document.querySelectorAll('.module-card').length>=24)return true;await new Promise(r=>setTimeout(r,150));}return false;})()`);

    const shot = async (name) => {
      const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const p = path.join(outDir, name + ".png");
      fs.writeFileSync(p, Buffer.from(r.data, "base64"));
      console.log("shot:", p);
    };

    // helper to drive clicks inside the page
    const drive = (body) => evalJs(`(async()=>{const click=async(el)=>{if(!el)throw new Error('missing el');el.click();await new Promise(r=>setTimeout(r,350));};const waitFor=async(pred,ms=8000)=>{const s=Date.now();while(Date.now()-s<ms){try{if(await pred())return true;}catch{}await new Promise(r=>setTimeout(r,120));}return false;};${body};return true;})()`);

    await shot("01-home");

    // reader: open M01 theory (module cards live on the Atlas screen, not Home)
    await drive(`const atlas=document.querySelector('.home-atlas-link,.atlas-link');if(atlas){await click(atlas);await waitFor(()=>document.querySelectorAll('.module-card').length>=1);}const m01=[...document.querySelectorAll('.module-card')].find(c=>c.querySelector('.mod-id')?.textContent.trim()==='M01')||document.querySelector('.module-card');await click(m01);await waitFor(()=>document.querySelectorAll('.lesson-section-card').length>=3);window.scrollTo(0,0);`);
    await delay(400);
    await shot("02-reader-top");
    await evalJs(`window.scrollTo(0, 520)`); await delay(300);
    await shot("03-reader-body");

    // quiz intro (duplicate CTA): go to quiz tab
    await drive(`const qt=document.querySelector('#tabs button[data-file="quiz.md"]');await click(qt);await waitFor(()=>document.querySelector('.quiz-intro'));window.scrollTo(0,0);`);
    await delay(300);
    await shot("04-quiz-intro");

    // quiz question (before answer): shows kicker + muted active tab
    await drive(`const b=[...document.querySelectorAll('.quiz-intro button')].find(x=>x.textContent.trim()==='Начать проверку');await click(b);await waitFor(()=>document.querySelectorAll('.quiz-q .opt').length>0);window.scrollTo(0,0);`);
    await delay(300);
    await shot("04b-quiz-question");

    // quiz feedback: answer
    await drive(`const opts=document.querySelectorAll('.quiz-q .opt');if(opts[1])opts[1].click();else opts[0].click();await waitFor(()=>document.querySelector('.quiz-diagnosis'));window.scrollTo(0,0);`);
    await delay(400);
    await shot("05-quiz-feedback");
    await evalJs(`const d=document.querySelector('.quiz-diagnosis');if(d)d.scrollIntoView();`); await delay(300);
    await shot("06-quiz-feedback-detail");

    // progress dashboard
    await drive(`const back=document.getElementById('back-btn');if(back&&!back.classList.contains('hidden'))await click(back);await waitFor(()=>document.querySelectorAll('.module-card').length>=24);await click(document.getElementById('profile-btn'));await waitFor(()=>document.querySelector('.profile-card')||document.querySelector('.dashboard-card'));window.scrollTo(0,0);`);
    await delay(400);
    await shot("07-progress");

    cdp.close();
    console.log("DONE ->", outDir);
  } finally {
    chrome.kill();
    server.close();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
