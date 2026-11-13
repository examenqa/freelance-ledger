const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { dataFileOverrideFromArgs } = require("../src/main/data-file-override");

test("uses an explicit data file argument without relying on saved application settings", () => {
  const expected = path.resolve("acceptance/working/payment-tracker-data.json");
  assert.equal(dataFileOverrideFromArgs(["electron", ".", "--data-file", "acceptance/working/payment-tracker-data.json"]), expected);
  assert.equal(dataFileOverrideFromArgs(["electron", ".", "--data-file=acceptance/working/payment-tracker-data.json"]), expected);
  assert.equal(dataFileOverrideFromArgs(["electron", "."]), "");
});
