const { app, BrowserWindow, dialog, ipcMain, session } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createDefaultData } = require("./src/shared/data-schema");
const { writeTextAtomically } = require("./src/main/data-store");
const { dataFileOverrideFromArgs } = require("./src/main/data-file-override");
const { createDataAccess } = require("./src/main/data-access");
const { configureReviewMode } = require("./src/main/review-mode");
const { reportHtml, xlsxBuffer } = require("./src/main/report-export");

const defaultDataFileName = "payment-tracker-data.json";
// This explicit test mode configures every Electron path before any profile read.
const reviewMode = configureReviewMode({ app, session, args: process.argv, bundleReadRoot: __dirname });
reviewMode?.prepareData(createDefaultData());
const storage = createDataAccess({
  userDataPath: () => app.getPath("userData"),
  dataFileOverride: reviewMode?.dataFilePath || dataFileOverrideFromArgs(process.argv),
});
const { dataPath, initSettings, readData, writeData } = storage;

function createWindow() {
  const iconPath = path.join(__dirname, "src", "assets", "app-icon.ico");
  const win = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    title: "Freelance Ledger by Examen QA",
    backgroundColor: "#eef2f7",
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.loadFile(path.join(__dirname, "src", "index.html"));
}

function registerHandlers() {
  ipcMain.handle("data:load", readData);
  ipcMain.handle("data:save", async (_event, data, options = {}) => {
    const backupReason = options?.backupReason === "destructive" ? "destructive" : "";
    await writeData(data, { backupReason });
    return readData();
  });
  ipcMain.handle("data:path", () => dataPath());
  ipcMain.handle("data:recovery-state", () => storage.recoveryState());
  ipcMain.handle("data:export", async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Export Payment Tracker Data",
      defaultPath: "payment-tracker-data-export.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (canceled || !filePath) return null;
    const currentData = await readData();
    await writeTextAtomically(filePath, JSON.stringify(currentData, null, 2));
    return filePath;
  });
  ipcMain.handle("data:import", async () => {
    const recovery = storage.recoveryState();
    if (!recovery.canImport) throw new Error(recovery.reason);
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Import Payment Tracker Data",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (canceled || !filePaths?.length) return null;
    const validation = await storage.validateFile(filePaths[0]);
    if (validation.warnings.length) {
      const warning = await dialog.showMessageBox(win, {
        type: "warning",
        title: "Review import warnings",
        message: "The file can be imported, with the following warnings.",
        detail: validation.warnings.slice(0, 12).join("\n") + (validation.warnings.length > 12 ? `\n…and ${validation.warnings.length - 12} more warnings.` : ""),
        buttons: ["Import with Warnings", "Cancel"],
        defaultId: 1,
        cancelId: 1,
      });
      if (warning.response !== 0) return null;
    }
    await writeData(validation.data, { backupReason: "import", recoveryImport: true });
    return validation.data;
  });
  ipcMain.handle("data:choose-file", async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Choose a valid Payment Tracker data file or backup",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (canceled || !filePaths?.length) return null;
    return storage.useDataFile(filePaths[0]);
  });
  ipcMain.handle("data:choose-path", async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!win) return null;

    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Choose data folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (canceled || !filePaths?.length) return null;

    const folderPath = filePaths[0];
    const nextDataPath = path.join(folderPath, defaultDataFileName);
    let fileExists = false;
    try {
      const stat = await fs.stat(nextDataPath);
      fileExists = stat.isFile();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    if (fileExists) {
      const choice = await dialog.showMessageBox(win, {
        type: "warning",
        title: "Data file already exists",
        message: "A payment tracker data file already exists in this folder.",
        detail: "Do you want to keep using the existing file? It will not be overwritten.",
        buttons: ["Use Existing File", "Cancel"],
        defaultId: 0,
        cancelId: 1,
      });
      if (choice.response !== 0) return null;
    } else {
      const choice = await dialog.showMessageBox(win, {
        type: "question",
        title: "Create an empty dataset?",
        message: "This folder has no Payment Tracker data file.",
        detail: "Create a new empty dataset here? Your previous data file will stay unchanged. To restore existing records, cancel and choose a valid data file or backup instead.",
        buttons: ["Create Empty Dataset", "Cancel"],
        defaultId: 1,
        cancelId: 1,
      });
      if (choice.response !== 0) return null;
      await writeTextAtomically(nextDataPath, JSON.stringify(createDefaultData(), null, 2));
    }
    return storage.useDataFile(nextDataPath);
  });
  ipcMain.handle("report:pdf", async (_event, report) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: `Save ${report?.title || "Payment Tracker"} PDF`,
      defaultPath: report?.pdfFilename || "Payment-Tracker-Report.pdf",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (canceled || !filePath) return null;
    const exportWin = new BrowserWindow({
      show: false,
      width: 1280,
      height: 1600,
      webPreferences: {
        sandbox: true,
      },
    });
    try {
      await exportWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(reportHtml(report))}`);
      const pdf = await exportWin.webContents.printToPDF({
        printBackground: true,
        marginsType: 1,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: '<div style="width:100%;font-size:8px;text-align:center;color:#64748b;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      });
      await fs.writeFile(filePath, pdf);
      return filePath;
    } finally {
      exportWin.destroy();
    }
  });
  ipcMain.handle("report:print", async (_event, report) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    const printWin = new BrowserWindow({ show: false, width: 1280, height: 1600, webPreferences: { sandbox: true } });
    try {
      await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(reportHtml(report))}`);
      await new Promise((resolve, reject) => {
        printWin.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
          if (success) resolve();
          else reject(new Error(failureReason || "Printing was cancelled."));
        });
      });
      return true;
    } finally {
      printWin.destroy();
    }
  });
  ipcMain.handle("report:xlsx", async (_event, report) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: `Save ${report?.title || "Payment Tracker"} Excel workbook`,
      defaultPath: report?.xlsxFilename || "Payment-Tracker-Report.xlsx",
      filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }],
    });
    if (canceled || !filePath) return null;
    await fs.writeFile(filePath, xlsxBuffer(report));
    return filePath;
  });
}

app.whenReady().then(() => {
  initSettings()
    .then(() => {
      registerHandlers();
      createWindow();
    })
    .catch((error) => {
      console.error("Failed to initialize settings", error);
      registerHandlers();
      createWindow();
    });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
