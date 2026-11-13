const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function harness(recovery) {
  function element(tag) {
    return { tag, id: "", dataset: {}, style: {}, children: [], disabled: false, textContent: "",
      matches(selector) { return this.id === "setup-import-data" && selector.includes("#setup-import-data"); },
      setAttribute() {}, append(...children) { this.children.push(...children); }, prepend(child) { this.children.unshift(child); },
      replaceChildren(...children) { this.children = [...children]; }, remove() { main.children = main.children.filter(child => child !== this); },
    };
  }
  const main = element("main");
  const importButton = element("button"); importButton.id = "setup-import-data";
  const financialInput = element("input");
  let confirms = 0, imports = 0;
  const context = vm.createContext({ console, Intl, Date, structuredClone,
    confirm() { confirms++; return true; }, alert() {},
    document: {
      createElement: element,
      querySelector(selector) {
        if (selector === "main") return main;
        if (selector === "#setup-import-data") return importButton;
        if (selector === "#data-recovery") return main.children.find(child => child.id === "data-recovery") || null;
        return null;
      },
      querySelectorAll() { return [financialInput, importButton]; },
    },
  });
  context.window = context;
  context.tracker = { recoveryState: async () => recovery, importData: async () => { imports++; return {}; } };
  const index = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
  for (const [, file] of index.matchAll(/<script src="\.\/(shared\/[^"<>]+\.js)"><\/script>/g)) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), context);
  const source = fs.readFileSync(path.join(__dirname, "../src/renderer.js"), "utf8");
  vm.runInContext(source.slice(0, source.lastIndexOf("\nboot(")), context);
  return { context, main, importButton, financialInput,
    call: code => vm.runInContext(code, context),
    actions: () => main.children[0].children.filter(child => child.dataset.recoveryAction).map(child => child.dataset.recoveryAction),
    counts: () => ({ confirms, imports }),
  };
}

test("unknown import target shows working recovery choices without offering replacement import", async () => {
  const h = harness({ canImport: false, reason: "Choose a valid data file or backup first; Import will then be available." });
  await h.call("showDataLoadError(new Error('Settings could not load'))");
  assert.deepEqual(h.actions(), ["retry", "choose"]);
  assert.equal(h.importButton.disabled, true);
  assert.equal(h.financialInput.disabled, true);
  assert.ok(h.main.children[0].children.some(child => child.textContent.includes("Import will then be available")));
  await h.call("importAvailableData()");
  assert.deepEqual(h.counts(), { confirms: 0, imports: 0 });
});

test("known failed dataset permits explicit backup import and successful recovery reenables it", async () => {
  const h = harness({ canImport: true, reason: "" });
  await h.call("showDataLoadError(new Error('Dataset is malformed'))");
  assert.deepEqual(h.actions(), ["retry", "choose", "import"]);
  assert.equal(h.importButton.disabled, false);
  h.call("setOverviewMonth = setDefaultWeek = setIncomingWeek = setIncomingWhtDefault = setDefaultPayoutWeek = setRecordReportMonth = render = () => {}; initializeLoadedData({});");
  assert.equal(h.importButton.disabled, false);
  assert.equal(h.financialInput.disabled, false);
  assert.equal(h.main.children.length, 0);
});
