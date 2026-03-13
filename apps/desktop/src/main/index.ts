import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { initializeLibraryPathing, LibraryPathError } from './library/pathManager';

const createWindow = (): void => {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const rendererUrl = process.env.VITE_DEV_SERVER_URL;

  if (rendererUrl) {
    window.loadURL(rendererUrl).catch((error: unknown) => {
      console.error('Failed to load renderer URL', error);
    });
    window.webContents.openDevTools({ mode: 'detach' });
    return;
  }

  window.loadFile(path.join(__dirname, '../renderer/index.html')).catch((error: unknown) => {
    console.error('Failed to load renderer file', error);
  });
};

const showStartupErrorAndExit = async (message: string): Promise<void> => {
  await dialog.showMessageBox({
    type: 'error',
    title: 'Vector Space',
    message: 'Unable to initialize local library',
    detail: message
  });

  app.quit();
};

app.whenReady().then(async () => {
  try {
    const libraryPaths = await initializeLibraryPathing();
    console.log('Library paths ready', libraryPaths);
  } catch (error: unknown) {
    if (error instanceof LibraryPathError) {
      await showStartupErrorAndExit(error.userMessage);
      return;
    }

    console.error('Unexpected startup error while initializing library paths', error);
    await showStartupErrorAndExit(
      'Vector Space could not initialize local storage. Please restart the app and try again.'
    );
    return;
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
