import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { SidecarManager } from './sidecar/SidecarManager'
import { AudioRecorder } from './audio/AudioRecorder'
import { SettingsStore } from './store/SettingsStore'
import { MeetingStore } from './store/MeetingStore'
import { IPCHandlers } from './ipc/handlers'
import { NativeModuleLoader } from './native/NativeModuleLoader'

let mainWindow: BrowserWindow | null = null
let sidecarManager: SidecarManager
let audioRecorder: AudioRecorder
let settingsStore: SettingsStore
let meetingStore: MeetingStore
let ipcHandlers: IPCHandlers

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
  } catch (err) {
    console.error('Failed to initialize app:', err)
  }
})

async function cleanup() {
  try { await sidecarManager?.stop() } catch {}
  try { await audioRecorder?.cleanup() } catch {}
}

app.on('before-quit', async () => {
  await cleanup()
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
