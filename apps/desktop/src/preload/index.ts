import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('vectorSpace', {
  appName: 'Vector Space Library'
});
