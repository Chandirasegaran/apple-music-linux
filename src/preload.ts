import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("appleMusicDesktop", {
  mediaControl: (action: "playpause" | "nexttrack" | "previoustrack") =>
    ipcRenderer.send("media-control", action),
  retryLoad: () => ipcRenderer.send("retry-load")
});
