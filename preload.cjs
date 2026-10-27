const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kimiWidget', {
  getState: () => ipcRenderer.invoke('widget:get-state'),
  getSettings: () => ipcRenderer.invoke('widget:get-settings'),
  updateSettings: (patch) => ipcRenderer.invoke('widget:update-settings', patch),
  refresh: () => ipcRenderer.invoke('widget:refresh'),
  setDemo: (enabled) => ipcRenderer.invoke('widget:set-demo', enabled),
  openSettings: () => ipcRenderer.invoke('widget:open-settings'),
  playSound: (kind) => ipcRenderer.invoke('widget:play-sound', kind),
  dragStart: (point) => ipcRenderer.send('widget:drag-start', point),
  dragMove: (point) => ipcRenderer.send('widget:drag-move', point),
  dragEnd: () => ipcRenderer.send('widget:drag-end'),
  onSound: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('widget:sound', listener)
    return () => ipcRenderer.removeListener('widget:sound', listener)
  },
  onSettings: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('widget:settings', listener)
    return () => ipcRenderer.removeListener('widget:settings', listener)
  },
  onState: (callback) => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('widget:state', listener)
    return () => ipcRenderer.removeListener('widget:state', listener)
  },
})
