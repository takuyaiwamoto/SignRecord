const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('signReplay', {
  fetchRecords: () => ipcRenderer.invoke('sign-records:fetch'),
  printImage: (dataUrl) => ipcRenderer.invoke('sign-records:print-image', dataUrl),
});
