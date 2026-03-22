const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  openExternal: (target) => ipcRenderer.invoke('external:open', target),
  listDirectory: (targetPath) => ipcRenderer.invoke('workspace:listDirectory', targetPath),
  openPath: (targetPath) => ipcRenderer.invoke('workspace:openPath', targetPath),
  revealPath: (targetPath) => ipcRenderer.invoke('workspace:revealPath', targetPath),
});

contextBridge.exposeInMainWorld('agent', {
  sendMessage: (provider, sessionId, message, options) =>
    ipcRenderer.invoke('agent:send', provider, sessionId, message, options),
  abort: (provider, sessionId) =>
    ipcRenderer.invoke('agent:abort', provider, sessionId),
  setSessionId: (provider, sessionId, providerSessionId) =>
    ipcRenderer.invoke('agent:setSessionId', provider, sessionId, providerSessionId),
  onEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('agent:event', listener);
    return () => ipcRenderer.removeListener('agent:event', listener);
  },
  loadHistory: (provider) => ipcRenderer.invoke('history:index', provider),
  loadSession: (provider, sessionId) => ipcRenderer.invoke('history:session', provider, sessionId),
  getVersion: (provider) => ipcRenderer.invoke('provider:version', provider),
  getProviderConfig: (provider) => ipcRenderer.invoke('provider:config', provider),
  setCodexFastMode: (enabled) => ipcRenderer.invoke('provider:setCodexFastMode', enabled),
  updateProvider: (provider) => ipcRenderer.invoke('provider:update', provider),
  openInCli: (sessionId, provider, cwd, providerSessionId) =>
    ipcRenderer.invoke('provider:openCli', sessionId, provider, cwd, providerSessionId),
  onCliExit: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('agent:cli-exit', listener);
    return () => ipcRenderer.removeListener('agent:cli-exit', listener);
  },
});

contextBridge.exposeInMainWorld('claude', {
  sendMessage: (sessionId, message, options) =>
    ipcRenderer.invoke('claude:send', sessionId, message, options),
  abort: (sessionId) => ipcRenderer.invoke('claude:abort', sessionId),
  setCCSessionId: (sessionId, ccSessionId) =>
    ipcRenderer.invoke('claude:setCCSessionId', sessionId, ccSessionId),
  onEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('agent:event', listener);
    return () => ipcRenderer.removeListener('agent:event', listener);
  },
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  selectFiles: () => ipcRenderer.invoke('dialog:selectFiles'),
  classifyPaths: (paths) => ipcRenderer.invoke('paths:classify', paths),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getDefaultCwd: () => ipcRenderer.invoke('app:getDefaultCwd'),
  saveClipboardImage: (base64Data, mimeType) =>
    ipcRenderer.invoke('clipboard:saveImage', base64Data, mimeType),
  readFileAsDataUrl: (filePath) =>
    ipcRenderer.invoke('file:readAsDataUrl', filePath),
  loadCCHistory: () => ipcRenderer.invoke('cchistory:index'),
  loadCCSession: (sessionId) => ipcRenderer.invoke('cchistory:session', sessionId),
  listSkills: () => ipcRenderer.invoke('skills:list'),
  getCCVersion: () => ipcRenderer.invoke('cc:version'),
  updateCC: () => ipcRenderer.invoke('cc:update'),
});
