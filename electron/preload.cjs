const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('signReplay', {
  fetchRecords: () => ipcRenderer.invoke('sign-records:fetch'),
});
