const path = require("node:path");

function dataFileOverrideFromArgs(args = []) {
  for (let index = 0; index < args.length; index += 1) {
    const value = String(args[index] || "");
    if (value.startsWith("--data-file=")) {
      const candidate = value.slice("--data-file=".length).trim();
      return candidate ? path.resolve(candidate) : "";
    }
    if (value === "--data-file") {
      const candidate = String(args[index + 1] || "").trim();
      return candidate ? path.resolve(candidate) : "";
    }
  }
  return "";
}

module.exports = { dataFileOverrideFromArgs };
