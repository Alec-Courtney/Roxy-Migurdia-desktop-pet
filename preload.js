const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('roxy', {
  startDrag: (x, y) => ipcRenderer.invoke('pet:drag-start', { x, y }),
  moveDrag: (x, y) => ipcRenderer.send('pet:drag-move', { x, y }),
  setDragLift: (enabled, x, y) => ipcRenderer.send('pet:drag-lift', enabled, { x, y }),
  endDrag: () => ipcRenderer.send('pet:drag-end'),
  setActionMode: (mode) => ipcRenderer.invoke('pet:set-action-mode', mode),
  showMenu: () => ipcRenderer.send('pet:show-menu'),
  onSpeak: (callback) => ipcRenderer.on('pet:speak', callback),
  onCast: (callback) => ipcRenderer.on('pet:cast', callback),
  onStorm: (callback) => ipcRenderer.on('pet:storm', callback),
  onAction: (callback) => ipcRenderer.on('pet:action', (_event, action) => callback(action))
});
