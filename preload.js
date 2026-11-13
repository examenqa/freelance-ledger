const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tracker", {
  loadData: () => ipcRenderer.invoke("data:load"),
  saveData: (data, options) => ipcRenderer.invoke("data:save", data, options),
  dataPath: () => ipcRenderer.invoke("data:path"),
  recoveryState: () => ipcRenderer.invoke("data:recovery-state"),
  exportData: () => ipcRenderer.invoke("data:export"),
  importData: () => ipcRenderer.invoke("data:import"),
  chooseDataPath: () => ipcRenderer.invoke("data:choose-path"),
  chooseDataFile: () => ipcRenderer.invoke("data:choose-file"),
  exportReportPdf: (report) => ipcRenderer.invoke("report:pdf", report),
  printReport: (report) => ipcRenderer.invoke("report:print", report),
  exportReportXlsx: (report) => ipcRenderer.invoke("report:xlsx", report),
});
