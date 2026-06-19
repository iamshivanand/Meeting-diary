import { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut } from 'electron'
import { join } from 'path'
import { SidecarManager } from './sidecar/SidecarManager'
import { AudioRecorder } from './audio/AudioRecorder'
import { SettingsStore } from './store/SettingsStore'
import { MeetingStore } from './store/MeetingStore'
import { IPCHandlers } from './ipc/handlers'
import { NativeModuleLoader } from './native/NativeModuleLoader'
import { autoUpdater } from 'electron-updater'

let mainWindow: BrowserWindow | null = null
let sidecarManager: SidecarManager
let audioRecorder: AudioRecorder
let settingsStore: SettingsStore
let meetingStore: MeetingStore
let ipcHandlers: IPCHandlers
let modelsDownloaded = false

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false
  })

  if (process.env.NODE_ENV === 'development') {
    await mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function initializeApp() {
  settingsStore = new SettingsStore()
  meetingStore = new MeetingStore(
    settingsStore.get('dataDirectory')
      ? settingsStore.get('dataDirectory')
      : join(app.getPath('userData'), 'meetings')
  )

  NativeModuleLoader.load()
  audioRecorder = new AudioRecorder()
  await audioRecorder.initialize()

  sidecarManager = new SidecarManager(join(__dirname, '../../sidecar/dist'))
  try {
    await sidecarManager.start()
  } catch (err) {
    console.warn('Sidecar failed to start (will try on demand):', err)
  }

  ipcHandlers = new IPCHandlers({
    mainWindow,
    audioRecorder,
    sidecarManager,
    settingsStore,
    meetingStore
  })
  ipcHandlers.register()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.whenReady().then(async () => {
  try {
    await initializeApp()
    await createWindow()

    // --- Keyboard Shortcuts ---
    // CmdOrCtrl+Shift+R - Start/Stop recording (toggle)
    // CmdOrCtrl+Shift+D - Navigate to Dashboard
    // CmdOrCtrl+Shift+S - Navigate to Settings
    // CmdOrCtrl+Shift+E - Open most recent meeting
    globalShortcut.register('CmdOrCtrl+Shift+R', () => {
      mainWindow?.webContents.send('shortcut', 'toggle-recording')
    })
    globalShortcut.register('CmdOrCtrl+Shift+D', () => {
      mainWindow?.webContents.send('shortcut', 'navigate-dashboard')
    })
    globalShortcut.register('CmdOrCtrl+Shift+S', () => {
      mainWindow?.webContents.send('shortcut', 'navigate-settings')
    })
    globalShortcut.register('CmdOrCtrl+Shift+E', () => {
      mainWindow?.webContents.send('shortcut', 'open-latest-meeting')
    })

    // --- Auto-Updater ---
    if (app.isPackaged) {
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = true

      autoUpdater.on('checking-for-update', () => {
        mainWindow?.webContents.send('update-status', { status: 'checking' })
      })
      autoUpdater.on('update-available', (info) => {
        mainWindow?.webContents.send('update-status', { status: 'available', info })
      })
      autoUpdater.on('update-not-available', () => {
        mainWindow?.webContents.send('update-status', { status: 'not-available' })
      })
      autoUpdater.on('download-progress', (progress) => {
        mainWindow?.webContents.send('update-status', { status: 'downloading', progress })
      })
      autoUpdater.on('update-downloaded', () => {
        mainWindow?.webContents.send('update-status', { status: 'downloaded' })
      })

      ipcMain.handle('check-for-updates', () => {
        autoUpdater.checkForUpdates()
      })
      ipcMain.handle('download-update', () => {
        autoUpdater.downloadUpdate()
      })
      ipcMain.handle('install-update', () => {
        autoUpdater.quitAndInstall()
      })

      setTimeout(() => {
        autoUpdater.checkForUpdates()
      }, 5000)
    }

    // Auto-download ML models on first launch
    autoDownloadModels()
  } catch (err) {
    console.error('Failed to initialize app:', err)
  }
})

async function autoDownloadModels() {
  try {
    const checkResult = await sidecarManager.request('check_models', {}) as { downloaded: boolean }
    if (checkResult.downloaded) {
      modelsDownloaded = true
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('model-download-progress', {
          stage: 'done', model: 'all', percent: 100, message: 'All models ready'
        })
      }
      return
    }
  } catch {
    // Sidecar not ready, models not downloaded — proceed to download
  }

  try {
    await sidecarManager.downloadModels((progress) => {
      if (progress.stage === 'done' && progress.model === 'all') {
        modelsDownloaded = true
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('model-download-progress', progress)
      }
    })
    modelsDownloaded = true
  } catch (err) {
    console.error('Model download failed:', err)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('model-download-progress', {
        stage: 'error', model: 'all', percent: 0, message: String(err)
      })
    }
  }
}

async function cleanup() {
  try { await sidecarManager?.stop() } catch {}
  try { await audioRecorder?.cleanup() } catch {}
}

app.on('before-quit', async () => {
  await cleanup()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', async () => {
  await cleanup()
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('app:get-version', () => app.getVersion())
ipcMain.handle('app:open-external', (_e, url: string) => shell.openExternal(url))
ipcMain.handle('app:show-save-dialog', async (_e, options) => {
  if (!mainWindow) return { canceled: true }
  return dialog.showSaveDialog(mainWindow, options)
})
ipcMain.handle('app:show-open-dialog', async (_e, options) => {
  if (!mainWindow) return { canceled: true }
  return dialog.showOpenDialog(mainWindow, options)
})
