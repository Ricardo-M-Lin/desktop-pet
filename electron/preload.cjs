const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopPet", {
  onStateChange(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("desktop-pet:state", listener);
    return () => ipcRenderer.removeListener("desktop-pet:state", listener);
  },
});
