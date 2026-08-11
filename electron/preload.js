// 渲染进程桥：仅暴露标题栏窗口控制所需的最小 API（contextIsolation 开启）
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopWindow', {
  isElectron: true,
  maximizeToggle: () => ipcRenderer.invoke('window:maximize-toggle'),
})
