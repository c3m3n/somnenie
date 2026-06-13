import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = process.cwd();
const dist = path.join(root, "dist");
const DEBUG_PORT = Number(process.env.NUTRIO_E2E_DEBUG_PORT || 9250);
const shotDir = path.join(os.tmpdir(), "nutrio-light-smoke");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function browserCandidates() {
  const where = process.platform === "win32" ? "where.exe" : "which";
  const fromPath = ["chrome", "chrome.exe", "msedge", "msedge.exe"].flatMap((name) => {
    const result = spawnSync(where, [name], { encoding: "utf8" });
    return result.status === 0 ? result.stdout.split(/\r?\n/).map((line) => line.trim()) : [];
  });
  const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
  const fixed = roots.flatMap((dir) => [
    path.join(dir, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(dir, "Microsoft", "Edge", "Application", "msedge.exe"),
  ]);
  return Array.from(new Set([process.env.CHROME_PATH, ...fromPath, ...fixed].filter(Boolean)));
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json" || ext === ".webmanifest") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".woff2") return "font/woff2";
  return "application/octet-stream";
}

function serveDist() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const file = path.normalize(path.join(dist, pathname));
    if (!file.startsWith(dist)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    fs.readFile(file, (error, body) => {
      if (error) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const headers = { "content-type": contentType(file) };
      if (pathname === "/sw.js") headers["service-worker-allowed"] = "/";
      res.writeHead(200, headers);
      res.end(body);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on("error", reject);
  });
}

async function waitForDevTools() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    } catch {
      await delay(150);
    }
  }
  throw new Error("Browser DevTools endpoint did not start");
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const callbacks = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) callbacks.reject(new Error(msg.error.message));
      else callbacks.resolve(msg.result);
      return;
    }
    if (msg.method) events.push(msg);
  };
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({
      events,
      send(method, params = {}, sessionId = null) {
        const id = ++seq;
        const message = { id, method, params };
        if (sessionId) message.sessionId = sessionId;
        ws.send(JSON.stringify(message));
        return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }));
      },
      close() {
        ws.close();
      },
    });
    ws.onerror = () => reject(new Error("WebSocket connection failed"));
  });
}

async function page(cdp) {
  const target = await cdp.send("Target.createTarget", { url: "about:blank" });
  const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  const send = (method, params = {}) => cdp.send(method, params, sessionId);
  const evalJs = (expression, awaitPromise = false) => send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  return { send, evalJs };
}

async function waitFor(evalJs, expression, label) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await evalJs(expression);
    if (!result.exceptionDetails && result.result?.value) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}

function value(result, label) {
  if (result.exceptionDetails) throw new Error(`${label}: ${result.exceptionDetails.text}`);
  return result.result.value;
}

async function screenshot(send, name) {
  fs.mkdirSync(shotDir, { recursive: true });
  const image = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(path.join(shotDir, name), Buffer.from(image.data, "base64"));
}

async function runSmoke(appUrl) {
  const chromePath = browserCandidates().find((candidate) => fs.existsSync(candidate));
  assert(chromePath, "Chrome or Edge executable was not found. Set CHROME_PATH to run smoke.");
  const userDataDir = path.join(os.tmpdir(), `nutrio-light-smoke-${Date.now()}`);
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-proxy-server",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--window-size=1280,900",
    "about:blank",
  ], { stdio: "ignore" });

  try {
    const version = await waitForDevTools();
    const cdp = await connect(version.webSocketDebuggerUrl);
    try {
      const desktop = await page(cdp);
      await desktop.send("Page.navigate", { url: appUrl });
      await waitFor(desktop.evalJs, "Boolean(document.querySelector('.today-screen'))", "Today");
      const desktopSummary = value(await desktop.evalJs(flowScript(), true), "desktop smoke");
      assert(desktopSummary.ok, JSON.stringify(desktopSummary, null, 2));
      await screenshot(desktop.send, "desktop-product.png");

      const mobile = await page(cdp);
      await mobile.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      await mobile.send("Page.navigate", { url: `${appUrl}?mobile=${Date.now()}` });
      await waitFor(mobile.evalJs, "Boolean(document.querySelector('.today-screen'))", "Mobile Today");
      const mobileSummary = value(await mobile.evalJs(mobileScript(), true), "mobile smoke");
      assert(mobileSummary.ok, JSON.stringify(mobileSummary, null, 2));
      await screenshot(mobile.send, "mobile-product.png");

      const browserErrors = cdp.events.filter((event) => {
        if (event.method === "Log.entryAdded") return event.params?.entry?.level === "error";
        if (event.method === "Runtime.consoleAPICalled") return event.params?.type === "error";
        return false;
      });
      assert(browserErrors.length === 0, `Browser errors: ${JSON.stringify(browserErrors, null, 2)}`);
      console.log(JSON.stringify({ url: appUrl, screenshots: shotDir, desktopSummary, mobileSummary }, null, 2));
    } finally {
      cdp.close();
    }
  } finally {
    chrome.kill();
  }
}

function flowScript() {
  return `(${async function smokeFlow() {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async (predicate, label) => {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (predicate()) return;
        await delay(100);
      }
      throw new Error("Timed out: " + label);
    };
    const clickText = async (selector, text) => {
      const element = [...document.querySelectorAll(selector)].find((item) => item.textContent.includes(text));
      if (!element) throw new Error("Missing " + text);
      element.click();
      await delay(200);
    };
    try {
      await clickText(".topnav button", "Атлас");
      await waitFor(() => document.querySelectorAll(".module-tile").length === 24, "Atlas modules");
      document.querySelector(".module-tile").click();
      await waitFor(() => document.querySelector(".station-screen"), "Station");
      const readingVisible = document.body.textContent.includes("Нутрициология — это наука");
      await clickText(".station-tabs button", "Проверить");
      await waitFor(() => document.querySelector(".quiz-card"), "Quiz");
      const quizVisible = document.body.textContent.includes("апельсиновый сок");
      await clickText(".topnav button", "Журнал");
      await waitFor(() => document.querySelector(".journal-screen"), "Journal");
      window.location.hash = "#station/M01/check";
      await waitFor(() => document.querySelector(".quiz-card"), "Product quiz frame");
      const noOverflow = document.documentElement.scrollWidth <= window.innerWidth + 1;
      return { ok: readingVisible && quizVisible && noOverflow, readingVisible, quizVisible, noOverflow };
    } catch (error) {
      return { ok: false, error: String(error && (error.stack || error.message || error)), body: document.body.innerText.slice(0, 700) };
    }
  }})()`;
}

function mobileScript() {
  return `(${async function mobileSmoke() {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const clickText = async (selector, text) => {
      const element = [...document.querySelectorAll(selector)].find((item) => item.textContent.includes(text));
      if (!element) throw new Error("Missing " + text);
      element.click();
      await delay(200);
    };
    try {
      await clickText(".topnav button", "Атлас");
      document.querySelector(".module-tile").click();
      await delay(500);
      const readingVisible = document.body.textContent.includes("Нутрициология — это наука");
      const tableEnhanced = Boolean(document.querySelector("td[data-label]"));
      document.querySelector("table")?.scrollIntoView({ block: "center" });
      await delay(100);
      const noOverflow = document.documentElement.scrollWidth <= window.innerWidth + 1;
      return { ok: readingVisible && tableEnhanced && noOverflow, readingVisible, tableEnhanced, noOverflow };
    } catch (error) {
      return { ok: false, error: String(error && (error.stack || error.message || error)), body: document.body.innerText.slice(0, 700) };
    }
  }})()`;
}

assert(fs.existsSync(path.join(dist, "index.html")), "dist/index.html is missing. Run npm run build first.");
const server = await serveDist();
const address = server.address();
try {
  await runSmoke(`http://127.0.0.1:${address.port}/`);
} finally {
  server.close();
}
