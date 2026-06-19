import { AudioCaptureStub } from './AudioCaptureStub'

export class NativeModuleLoader {
  private static loaded = false
  private static instance: any = null

  static load(): any {
    if (this.loaded) return this.instance

    const platform = process.platform
    const isDev = process.env.NODE_ENV === 'development'
    const app = require('electron')

    const searchPaths: string[] = []
    if (isDev) {
      searchPaths.push(require('path').join(__dirname, '..', '..', '..', 'native'))
    } else {
      try { searchPaths.push(require('path').join(app.app.getAppPath(), 'native')) } catch {}
      try { searchPaths.push(require('path').join(process.resourcesPath || '', 'native')) } catch {}
    }

    for (const basePath of searchPaths) {
      const modulePath = require('path').join(basePath, platform, process.arch)

      if (platform === 'win32') {
        try {
          const wasapiPath = require('path').join(modulePath, 'wasapi_capture.node')
          if (require('fs').existsSync(wasapiPath)) {
            const mod = require(wasapiPath)
            this.loaded = true
            this.instance = { AudioCapture: mod.AudioCapture || mod.default || mod }
            console.log('Native WASAPI capture module loaded')
            return this.instance
          }
        } catch (err) {
          console.warn('Failed to load WASAPI module:', (err as Error).message)
        }
      } else if (platform === 'darwin') {
        try {
          const scPath = require('path').join(modulePath, 'screencapturekit_capture.node')
          if (require('fs').existsSync(scPath)) {
            const mod = require(scPath)
            this.loaded = true
            this.instance = { AudioCapture: mod.AudioCapture || mod.default || mod }
            console.log('Native ScreenCaptureKit module loaded')
            return this.instance
          }
        } catch (err) {
          console.warn('Failed to load ScreenCaptureKit module:', (err as Error).message)
        }
      }
    }

    console.log('No native capture module found. Using JS stub (requires ffmpeg/sox for real capture).')
    this.loaded = true
    this.instance = { AudioCapture: AudioCaptureStub }
    return this.instance
  }

  static getInstance(): any {
    return this.instance
  }

  static isLoaded(): boolean {
    return this.loaded
  }
}
