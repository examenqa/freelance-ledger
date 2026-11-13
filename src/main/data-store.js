const fs = require("node:fs/promises");
const path = require("node:path");

const BACKUP_DIRECTORY_NAME = "backups";
const MAX_BACKUPS = 30;
const AUTOMATIC_BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

function backupDirectoryFor(dataFilePath) {
  return path.join(path.dirname(dataFilePath), BACKUP_DIRECTORY_NAME);
}

function snapshotName(dataFilePath, reason, now = new Date()) {
  const safeReason = String(reason || "automatic").replace(/[^a-z0-9-]/gi, "-");
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `${path.basename(dataFilePath, path.extname(dataFilePath))}.${stamp}.${safeReason}.json`;
}

async function listSnapshots(dataFilePath) {
  const directory = backupDirectoryFor(dataFilePath);
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const snapshots = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const filePath = path.join(directory, entry.name);
          return { filePath, stat: await fs.stat(filePath) };
        }),
    );
    return snapshots.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function createSnapshot(dataFilePath, { reason = "automatic", force = false, now = new Date() } = {}) {
  try {
    await fs.access(dataFilePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }

  const snapshots = await listSnapshots(dataFilePath);
  if (!force && snapshots[0] && now.valueOf() - snapshots[0].stat.mtimeMs < AUTOMATIC_BACKUP_INTERVAL_MS) return null;

  const directory = backupDirectoryFor(dataFilePath);
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, snapshotName(dataFilePath, reason, now));
  await fs.copyFile(dataFilePath, target);

  const updatedSnapshots = await listSnapshots(dataFilePath);
  // Files copied from the same data file can share an identical filesystem mtime.
  // Always retain the snapshot just created, even when tied ordering would otherwise
  // place it in the rotation tail.
  const removableSnapshots = updatedSnapshots.filter((snapshot) => snapshot.filePath !== target);
  await Promise.all(removableSnapshots.slice(MAX_BACKUPS - 1).map((snapshot) => fs.unlink(snapshot.filePath)));
  return target;
}

async function writeTextAtomically(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporaryPath, contents, "utf8");
  await fs.rename(temporaryPath, filePath);
}

module.exports = {
  AUTOMATIC_BACKUP_INTERVAL_MS,
  BACKUP_DIRECTORY_NAME,
  MAX_BACKUPS,
  backupDirectoryFor,
  createSnapshot,
  listSnapshots,
  writeTextAtomically,
};
