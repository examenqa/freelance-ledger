const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { fileURLToPath } = require("node:url");

const MARKER = ".payment-tracker-isolated-review.json";
const PURPOSE = "Payment Tracker disposable review";
const NETWORK_PROBE_URL = "https://example.invalid/payment-tracker-isolation-probe";

function reviewRootFromArgs(args = []) {
  const index = args.findIndex(value => String(value).startsWith("--review-root=") || value === "--review-root");
  if (index < 0) return "";
  const value = String(args[index]).startsWith("--review-root=") ? String(args[index]).slice(14) : String(args[index + 1] || "");
  if (!value || !path.isAbsolute(value)) throw new Error("--review-root requires an absolute disposable directory.");
  const root = path.resolve(value);
  const normalized = root.toLowerCase();
  const inside = parent => parent && (normalized === path.resolve(parent).toLowerCase() || normalized.startsWith(path.resolve(parent).toLowerCase() + path.sep));
  if (root === path.parse(root).root || normalized === os.homedir().toLowerCase() || [process.env.APPDATA, process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.WINDIR].some(inside)) {
    throw new Error("The review root must be a separate disposable directory outside application profiles and system folders.");
  }
  return root;
}

function installFileGuard(root, record = () => {}, { bundleReadRoot = "" } = {}) {
  const originalRealpath = fs.realpathSync.bind(fs);
  const originalLstat = fs.lstatSync.bind(fs);
  const originalExists = fs.existsSync.bind(fs);
  const normalize = value => path.resolve(value instanceof URL ? fileURLToPath(value) : String(value));
  function allowed(value) {
    if (typeof value === "number") return false;
    let target;
    try { target = normalize(value); } catch { return false; }
    const base = root.toLowerCase();
    if (target.toLowerCase() !== base && !target.toLowerCase().startsWith(base + path.sep)) return false;
    let existing = target;
    while (!originalExists(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) return false;
      existing = parent;
    }
    const real = originalRealpath(existing).toLowerCase();
    if (real !== base && !real.startsWith(base + path.sep)) return false;
    // A hard-linked external file must not become writable through the review.
    if (originalExists(target)) {
      const stat = originalLstat(target);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) return false;
    }
    return true;
  }
  function check(method, values) {
    if (values.some(value => !allowed(value))) {
      record({ type: "blocked-write", method });
      throw new Error("Isolated review blocked a filesystem change outside its disposable directory.");
    }
    record({ type: "write", method });
  }
  function runtimeReadAllowed(value) {
    if (!bundleReadRoot || typeof value === "number") return false;
    try {
      const target = normalize(value);
      const relative = path.relative(bundleReadRoot, target).replace(/\\/g, "/");
      const known = ["main.js", "preload.js", "package.json"].includes(relative) || /^src\/[^]*\.(?:js|css|html|png|ico|svg|woff2?)$/i.test(relative);
      if (!known || relative.startsWith("../") || path.isAbsolute(relative)) return false;
      const realBase = originalRealpath(bundleReadRoot).toLowerCase();
      const realTarget = originalRealpath(target).toLowerCase();
      return realTarget.startsWith(realBase + path.sep);
    } catch { return false; }
  }
  const mutations = { writeFile: [0], appendFile: [0], mkdir: [0], rm: [0], rmdir: [0], unlink: [0], truncate: [0], rename: [0, 1], copyFile: [1], cp: [1], chmod: [0], chown: [0], utimes: [0] };
  for (const [name, indexes] of Object.entries(mutations)) {
    for (const api of [fs, fsp]) {
      const original = api[name]?.bind(api);
      if (original) api[name] = (...args) => { check(name, indexes.map(index => args[index])); return original(...args); };
    }
    const nameSync = `${name}Sync`;
    const originalSync = fs[nameSync]?.bind(fs);
    if (originalSync) fs[nameSync] = (...args) => { check(nameSync, indexes.map(index => args[index])); return originalSync(...args); };
  }
  const writes = flags => typeof flags === "number"
    ? Boolean(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND))
    : /[wa+]/.test(String(flags));
  for (const [api, method] of [[fs, "open"], [fs, "openSync"], [fsp, "open"]]) {
    const original = api[method].bind(api);
    api[method] = (file, flags, ...args) => { if (writes(flags)) check(method, [file]); return original(file, flags, ...args); };
  }
  const originalStream = fs.createWriteStream.bind(fs);
  fs.createWriteStream = (file, ...args) => { check("createWriteStream", [file]); return originalStream(file, ...args); };
  for (const api of [fs, fsp]) {
    for (const method of ["symlink", "link", "symlinkSync", "linkSync"]) {
      if (api[method]) api[method] = () => { throw new Error("Links are disabled in isolated review mode."); };
    }
  }
  // Main-process dataset/settings/import reads also stay inside the review.
  const originalRead = fsp.readFile.bind(fsp);
  fsp.readFile = (file, ...args) => {
    if (!allowed(file) && !runtimeReadAllowed(file)) throw new Error("Isolated review can only read data files copied into its disposable directory.");
    return originalRead(file, ...args);
  };
  return { allowed };
}

function configureReviewMode({ app, session, args = process.argv, bundleReadRoot = "" }) {
  let root = reviewRootFromArgs(args);
  if (!root) return null;
  const fresh = !fs.existsSync(root);
  if (fresh) {
    // Parent must already exist; never create ancestors of a supplied path.
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, MARKER), JSON.stringify({ purpose: PURPOSE, version: 1 }), { flag: "wx" });
  } else {
    if (fs.lstatSync(root).isSymbolicLink()) throw new Error("The review root cannot be a link.");
    const marker = JSON.parse(fs.readFileSync(path.join(root, MARKER), "utf8"));
    if (marker.purpose !== PURPOSE || marker.version !== 1) throw new Error("An existing review directory must have a valid isolated-review marker.");
  }
  root = fs.realpathSync(root);
  // High-level appendFileSync delegates to public fs methods. Once guarded,
  // logging from those methods would recurse into the logger. Hold a private
  // descriptor opened before guarding and write through the unwrapped primitive.
  const auditFd = fs.openSync(path.join(root, "review-runtime.jsonl"), "a");
  const writeAudit = fs.writeSync.bind(fs);
  const closeAudit = fs.closeSync.bind(fs);
  const record = entry => writeAudit(auditFd, JSON.stringify({ time: new Date().toISOString(), ...entry }) + "\n");
  app.on("will-quit", () => closeAudit(auditFd));
  record({ type: "bootstrap-stage", stage: "root-ready" });
  for (const name of ["profile", "temp", "logs", "crash", "downloads"]) fs.mkdirSync(path.join(root, name), { recursive: true });
  const profile = path.join(root, "profile");
  for (const name of ["appData", "userData", "sessionData"]) app.setPath(name, profile);
  for (const [name, folder] of [["temp", "temp"], ["logs", "logs"], ["crashDumps", "crash"], ["downloads", "downloads"]]) app.setPath(name, path.join(root, folder));
  app.commandLine.appendSwitch("disable-background-networking");
  record({ type: "bootstrap-stage", stage: "paths-configured" });
  const { allowed } = installFileGuard(root, record, { bundleReadRoot });
  record({ type: "bootstrap-stage", stage: "guard-installed" });
  let rejected = false;
  try { fsp.writeFile(path.join(root, "..", "review-guard-probe-must-not-exist.txt"), "blocked"); }
  catch { rejected = true; }
  if (!rejected) throw new Error("Isolated review write-guard self-test failed.");
  record({ type: "guard-self-test", outsideWriteRejected: true });
  const locked = new WeakSet();
  let networkProbeBlocked = false;
  let networkProbeStarted = false;
  const lockSession = ses => {
    if (!ses || locked.has(ses)) return;
    locked.add(ses);
    ses.webRequest.onBeforeRequest((details, callback) => {
      const allow = /^(file:|data:|about:|devtools:)/.test(details.url);
      if (!allow) {
        const probe = details.url === NETWORK_PROBE_URL;
        if (probe) networkProbeBlocked = true;
        record({ type: "blocked-network", scheme: details.url.split(":")[0], probe });
      }
      callback({ cancel: !allow });
    });
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  };
  app.on("session-created", lockSession);
  app.whenReady().then(() => lockSession(session.defaultSession));
  app.on("browser-window-created", (_event, win) => {
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event, url) => { if (!/^(file:|data:|about:)/.test(url)) event.preventDefault(); });
    const captureGeometry = async () => {
      if (win.isDestroyed() || win.webContents.isDestroyed()) return;
      try {
        const geometry = await win.webContents.executeJavaScript(`(() => ({
          viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio },
          activeTab: document.querySelector('[data-tab].active')?.dataset.tab || '',
          tables: [...document.querySelectorAll('.table-wrap')].filter(node => node.getClientRects().length).map(node => ({
            container: node.parentElement?.id || '',
            height: node.clientHeight, scrollHeight: node.scrollHeight,
            width: node.clientWidth, scrollWidth: node.scrollWidth,
            rows: node.querySelectorAll('tbody tr').length
          }))
        }))()`);
        record({ type: "geometry", window: { bounds: win.getBounds(), contentBounds: win.getContentBounds(), maximized: win.isMaximized() }, ...geometry });
      } catch { record({ type: "geometry-unavailable" }); }
    };
    let resizeTimer;
    win.on("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(captureGeometry, 150);
    });
    win.webContents.on("console-message", (_event, level, message) => {
      if (level >= 2) record({ type: "console", level, message });
    });
    win.webContents.on("did-finish-load", () => {
      win.setTitle("ISOLATED REVIEW — Freelance Ledger by Examen QA");
      record({ type: "loaded", version: app.getVersion(), electron: process.versions.electron, pid: process.pid,
        window: { bounds: win.getBounds(), maximized: win.isMaximized() },
        userData: app.getPath("userData"), sessionData: app.getPath("sessionData"), dataFilePath: path.join(root, "payment-tracker-data.json") });
      captureGeometry();
      if (!networkProbeStarted) {
        networkProbeStarted = true;
        // Synthetic, credential-free request to a reserved invalid domain. A
        // rejected fetch alone is insufficient: also record interception by the guard.
        win.webContents.executeJavaScript(`fetch(${JSON.stringify(NETWORK_PROBE_URL)}, { credentials: 'omit', cache: 'no-store' }).then(() => false, () => true)`)
          .then(requestRejected => record({ type: "network-probe", requestRejected, blockedByGuard: networkProbeBlocked }))
          .catch(() => record({ type: "network-probe-unavailable", blockedByGuard: networkProbeBlocked }));
      }
    });
  });
  record({ type: "bootstrap", root, fresh });
  return {
    root,
    dataFilePath: path.join(root, "payment-tracker-data.json"),
    allowed,
    prepareData(data) {
      if (fresh) fs.writeFileSync(path.join(root, "payment-tracker-data.json"), JSON.stringify(data, null, 2), { flag: "wx" });
    },
  };
}

module.exports = { reviewRootFromArgs, installFileGuard, configureReviewMode };
