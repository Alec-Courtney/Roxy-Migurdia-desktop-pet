const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('roxy', {
  startDrag: (x, y) => ipcRenderer.invoke('pet:drag-start', { x, y }),
  startDockDrag: (edge, x, y) => ipcRenderer.invoke('pet:dock-drag-start', edge, { x, y }),
  moveDrag: (x, y) => ipcRenderer.send('pet:drag-move', { x, y }),
  setDragLift: (enabled, x, y) => ipcRenderer.send('pet:drag-lift', enabled, { x, y }),
  endDrag: (x, y, options) => ipcRenderer.invoke('pet:drag-end', { x, y }, options),
  startDockEnter: (edge, duration) => ipcRenderer.invoke('pet:dock-enter-start', edge, duration),
  finishDockEnter: (edge) => ipcRenderer.invoke('pet:dock-enter-complete', edge),
  startDockExit: (edge, duration) => ipcRenderer.invoke('pet:dock-exit-start', edge, duration),
  finishDockExit: (edge) => ipcRenderer.invoke('pet:dock-exit-complete', edge),
  redock: (edge) => ipcRenderer.invoke('pet:dock-redock', edge),
  cancelPreparedDock: (edge) => ipcRenderer.invoke('pet:dock-cancel-prepared', edge),
  resetDock: () => ipcRenderer.invoke('pet:dock-reset-request'),
  setActionMode: (mode) => ipcRenderer.invoke('pet:set-action-mode', mode),
  showMenu: () => ipcRenderer.send('pet:show-menu'),
  onSpeak: (callback) => ipcRenderer.on('pet:speak', callback),
  onCast: (callback) => ipcRenderer.on('pet:cast', callback),
  onStorm: (callback) => ipcRenderer.on('pet:storm', callback),
  onAction: (callback) => ipcRenderer.on('pet:action', (_event, action) => callback(action)),
  onInteraction: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('pet:interaction', listener);
    return () => ipcRenderer.removeListener('pet:interaction', listener);
  },
  onDockReset: (callback) => {
    const listener = (_event, geometry) => callback(geometry);
    ipcRenderer.on('pet:dock-reset', listener);
    return () => ipcRenderer.removeListener('pet:dock-reset', listener);
  }
});
