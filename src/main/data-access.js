const fs = require("node:fs/promises");
const path = require("node:path");
const { CURRENT_SCHEMA_VERSION, createDefaultData, validateData } = require("../shared/data-schema");
const { createSnapshot, writeTextAtomically } = require("./data-store");

function createDataAccess({ userDataPath, dataFileOverride = "" }) {
  let settings = { dataFilePath: "" };
  let sessionPath = dataFileOverride;
  let initialized = false;
  let loadedPath = "";
  const profilePath = () => typeof userDataPath === "function" ? userDataPath() : userDataPath;
  const settingsPath = () => path.join(profilePath(), "payment-tracker-settings.json");
  const defaultPath = () => path.join(profilePath(), "payment-tracker-data.json");
  const dataPath = () => sessionPath || settings.dataFilePath?.trim() || defaultPath();

  async function initSettings() {
    if (sessionPath) {
      // A session override must never read the normal profile's custom path.
      initialized = true;
      return;
    }
    initialized = false;
    try {
      const value = JSON.parse((await fs.readFile(settingsPath(), "utf8")).replace(/^\uFEFF/, ""));
      if (!value || typeof value !== "object" || Array.isArray(value) || (value.dataFilePath !== undefined && typeof value.dataFilePath !== "string")) {
        throw new Error("The settings file does not contain a valid data path.");
      }
      settings = { ...settings, ...value };
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error(`Settings could not load. Choose a valid data file to recover. ${error.message}`);
    }
    initialized = true;
  }

  function validateCurrentData(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const version = value.schemaVersion === undefined ? 0 : value.schemaVersion;
      if (Number.isInteger(version) && version >= 0 && version < CURRENT_SCHEMA_VERSION) {
        throw new Error(`This file uses older data schema ${version}. It remains read-only. Migration requires separate authorization; choose a current-format file or backup.`);
      }
    }
    const validation = validateData(value);
    if (!validation.valid) throw new Error(`Data validation failed: ${validation.errors.join(" ")}`);
    return validation;
  }

  async function validateFile(filePath) {
    const text = (await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/, "");
    return validateCurrentData(JSON.parse(text));
  }

  async function readData() {
    loadedPath = "";
    await initSettings();
    const target = dataPath();
    try {
      const validation = await validateFile(target);
      // Loading/recovery never writes or migrates the input.
      loadedPath = target;
      return validation.data;
    } catch (error) {
      if (error.code === "ENOENT" && !sessionPath && !settings.dataFilePath?.trim()) {
        loadedPath = target;
        return createDefaultData();
      }
      throw new Error(`Data could not load. The original file has not been changed. ${error.message}`);
    }
  }

  async function writeData(data, { backupReason = "", recoveryImport = false } = {}) {
    if (!initialized) await initSettings();
    if (!recoveryImport && loadedPath !== dataPath()) throw new Error("Data is unavailable. Retry or choose a valid data file before saving.");
    const validation = validateCurrentData(data);
    const reason = backupReason;
    await createSnapshot(dataPath(), { reason: reason || "automatic", force: Boolean(reason) });
    await writeTextAtomically(dataPath(), JSON.stringify(validation.data, null, 2));
    loadedPath = dataPath();
    return validation.data;
  }

  async function useDataFile(filePath) {
    // Validate before changing settings or the selected path. Bad/cancelled
    // recovery choices leave both the previous file and settings untouched.
    const target = path.resolve(filePath);
    await validateFile(target);
    if (dataFileOverride) {
      sessionPath = target;
    } else {
      const nextSettings = { ...settings, dataFilePath: target };
      await createSnapshot(settingsPath(), { reason: "settings-path-change", force: true });
      await writeTextAtomically(settingsPath(), JSON.stringify(nextSettings, null, 2));
      settings = nextSettings;
    }
    initialized = true;
    loadedPath = target;
    return target;
  }

  function recoveryState() {
    return {
      canImport: initialized,
      reason: initialized ? "" : "The settings could not establish a replacement destination. Choose a valid data file or backup first; Import will then be available.",
    };
  }

  return { dataPath, initSettings, readData, writeData, useDataFile, validateFile, recoveryState };
}

module.exports = { createDataAccess };
