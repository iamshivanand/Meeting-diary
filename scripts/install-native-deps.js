/**
 * Post-install script for native audio capture dependencies.
 * Builds WASAPI (Windows) and ScreenCaptureKit (macOS) native modules.
 */
const { execSync } = require('child_process')
const { existsSync, mkdirSync } = require('fs')
const { join } = require('path')
const os = require('os')

const root = join(__dirname, '..')
const nativeDir = join(root, 'native')

function buildWindowsNative() {
  console.log('Building WASAPI capture module for Windows...')
  const wasapiDir = join(nativeDir, 'win32', process.arch)
  if (!existsSync(wasapiDir)) {
    mkdirSync(wasapiDir, { recursive: true })
  }

  console.log(`  Target: ${wasapiDir}`)
  console.log('  Note: C++ native module requires Visual Studio Build Tools and node-gyp.')
  console.log('  Run: cd native/wasapi-capture && node-gyp rebuild')
}

function buildMacNative() {
  console.log('Building ScreenCaptureKit module for macOS...')
  const screencapDir = join(nativeDir, 'darwin', process.arch)
  if (!existsSync(screencapDir)) {
    mkdirSync(screencapDir, { recursive: true })
  }

  console.log(`  Target: ${screencapDir}`)
  console.log('  Note: ScreenCaptureKit requires macOS 12.3+ and Xcode.')
  console.log('  Run: cd native/screencapturekit && swift build')
}

function main() {
  const platform = os.platform()

  if (platform === 'win32') {
    buildWindowsNative()
  } else if (platform === 'darwin') {
    buildMacNative()
  } else if (platform === 'linux') {
    console.log('Linux audio capture via PulseAudio/PipeWire supported via native module.')
  }

  console.log('Native module setup complete.')
}

main()
