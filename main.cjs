const { app, BrowserWindow, Menu, ipcMain, powerMonitor, shell } = require('electron')
const path = require('node:path')
const net = require('node:net')
const readline = require('node:readline')
const { spawn } = require('node:child_process')
const { fetchQuota, demoQuota } = require('./src/quota.cjs')
const { SettingsStore, normalizeSettings } = require('./src/settings.cjs')

const PANEL_WIDTH = 310
const CHARACTER_WIDTH = 190
const BASE_HEIGHT = 360
const LAUNCHER_WIDTH = 36
const LAUNCHER_HEIGHT = 36
const LAUNCHER_BOTTOM_OFFSET = 50
const HOST_EXIT_GRACE_MS = 1500
const AUTH_FAILURE_GRACE_MS = 5 * 60 * 1000
// 宿主最小化或被隐藏时 Windows 会给出 -25600,-25600 的占位矩形（约 159x27），
// 不能拿它算缩放或定位，否则挂件会被缩成几像素。
const MIN_HOST_WIDTH = 320
const MIN_HOST_HEIGHT = 240
const PIPE_NAME = '\\\\.\\pipe\\kimi-niang-quota'
let win = null
let launcherWin = null
let settingsWindow = null
let notificationServer = null
let hostTracker = null
let hostInfo = null
let hostExitTimer = null
let syncing = false
let lastCompletionAt = 0
let firstAuthFailureAt = null
let store = null
let settings = null
let refreshTimer = null
let saveTimer = null
let activeRequest = null
let requestSequence = 0
let widgetDismissed = false
let state = emptyState(process.argv.includes('--demo'))

function emptyState(demo = false) {
  return {
    loading: false,
    demo,
    quotas: demo ? demoQuota() : {},
    error: null,
    stale: false,
    updatedAt: demo ? new Date().toISOString() : null,
  }
}

function publicSettings() {
  if (!settings) return {}
  const { position, launcherPosition, demo, ...value } = settings
  return value
}

function publicState() {
  return { ...state, ...publicSettings(), fitScale: hostFitScale(), hostName: hostInfo?.processName || null }
}

function sendState() {
  if (win && !win.isDestroyed()) win.webContents.send('widget:state', publicState())
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('widget:settings', publicSettings())
}

function saveSettings() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => store?.save(settings), 250)
}

function hostUsable(info) {
  if (!info?.found || !info.visible || info.minimized) return false
  return Number(info.width) >= MIN_HOST_WIDTH && Number(info.height) >= MIN_HOST_HEIGHT
}

function hostFitScale() {
  if (!hostUsable(hostInfo)) return 1
  const width = PANEL_WIDTH * (settings?.panelScale || 1) + CHARACTER_WIDTH * (settings?.characterScale || 1)
  const height = BASE_HEIGHT * Math.max(settings?.characterScale || 1, settings?.panelScale || 1)
  return Math.max(0.01, Math.min(1, (hostInfo.width - 4) / width, (hostInfo.height - 4) / height))
}

function windowSize() {
  const fit = hostFitScale()
  return {
    width: Math.round((PANEL_WIDTH * (settings?.panelScale || 1) + CHARACTER_WIDTH * (settings?.characterScale || 1)) * fit),
    height: Math.round(BASE_HEIGHT * Math.max(settings?.characterScale || 1, settings?.panelScale || 1) * fit),
  }
}

function clampToHost(bounds) {
  const { width, height } = windowSize()
  if (!hostUsable(hostInfo)) return { ...bounds, width, height }
  return {
    ...bounds,
    width,
    height,
    x: Math.max(hostInfo.x + 2, Math.min(bounds.x, hostInfo.x + hostInfo.width - width - 2)),
    y: Math.max(hostInfo.y + 2, Math.min(bounds.y, hostInfo.y + hostInfo.height - height - 2)),
  }
}

function savePosition() {
  if (!win || !hostUsable(hostInfo)) return
  const bounds = win.getBounds()
  settings.position = { x: bounds.x - hostInfo.x, y: bounds.y - hostInfo.y }
}

let snapping = false
function snapWindow() {
  if (!win || !settings.edgeSnap || snapping || !hostUsable(hostInfo)) return
  const bounds = win.getBounds()
  const { width } = windowSize()
  const leftDistance = Math.abs(bounds.x - hostInfo.x)
  const rightDistance = Math.abs(hostInfo.x + hostInfo.width - bounds.x - width)
  const side = leftDistance < rightDistance ? 'left' : 'right'
  settings.side = side
  const target = clampToHost({
    ...bounds,
    x: side === 'left' ? hostInfo.x + 12 : hostInfo.x + hostInfo.width - width - 12,
  })
  snapping = true
  win.setBounds(target, false)
  snapping = false
  savePosition()
  saveSettings()
  sendState()
}

function applyLayout() {
  if (!win || win.isDestroyed()) return
  const current = win.getBounds()
  let target = clampToHost(current)
  if (settings.edgeSnap && hostUsable(hostInfo)) {
    const leftDistance = Math.abs(current.x - hostInfo.x)
    const rightDistance = Math.abs(hostInfo.x + hostInfo.width - current.x - current.width)
    settings.side = leftDistance < rightDistance ? 'left' : 'right'
    target = clampToHost({
      ...target,
      x: settings.side === 'left' ? hostInfo.x + 12 : hostInfo.x + hostInfo.width - target.width - 12,
    })
  }
  if (['x', 'y', 'width', 'height'].some((key) => target[key] !== current[key])) {
    syncing = true
    win.setBounds(target, false)
    syncing = false
  }
  savePosition()
  saveSettings()
  sendState()
}

function launcherBounds(info) {
  const availableWidth = Math.max(0, info.width - LAUNCHER_WIDTH - 4)
  const availableHeight = Math.max(0, info.height - LAUNCHER_HEIGHT - 4)
  const position = settings?.launcherPosition
  return {
    width: LAUNCHER_WIDTH,
    height: LAUNCHER_HEIGHT,
    x: info.x + 2 + Math.round(availableWidth * (position?.xRatio ?? 0.295)),
    y: position
      ? info.y + 2 + Math.round(availableHeight * position.yRatio)
      : Math.max(info.y + 2, info.y + info.height - LAUNCHER_HEIGHT - LAUNCHER_BOTTOM_OFFSET),
  }
}

function saveLauncherPosition() {
  if (!launcherWin || !hostUsable(hostInfo)) return
  const bounds = launcherWin.getBounds()
  settings.launcherPosition = {
    xRatio: Math.max(0, Math.min(1, (bounds.x - hostInfo.x - 2) / Math.max(1, hostInfo.width - LAUNCHER_WIDTH - 4))),
    yRatio: Math.max(0, Math.min(1, (bounds.y - hostInfo.y - 2) / Math.max(1, hostInfo.height - LAUNCHER_HEIGHT - 4))),
  }
}

function revealWidget() {
  if (!hostUsable(hostInfo)) return
  widgetDismissed = false
  if (launcherWin && !launcherWin.isDestroyed()) {
    launcherWin.setBounds(launcherBounds(hostInfo), false)
    launcherWin.showInactive()
  }
  if (win && !win.isDestroyed()) {
    win.showInactive()
    win.webContents.send('widget:reveal')
  }
  refreshQuota()
}

function dismissWidget() {
  widgetDismissed = true
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close()
  if (win && !win.isDestroyed()) win.hide()
}

function updateHost(info) {
  const previous = hostInfo
  const changed = previous?.handle !== info.handle || previous?.visible !== info.visible ||
    previous?.x !== info.x || previous?.y !== info.y || previous?.width !== info.width || previous?.height !== info.height
  if (Number(info.hostProcessCount) === 0) {
    if (!hostExitTimer) hostExitTimer = setTimeout(() => app.quit(), HOST_EXIT_GRACE_MS)
  } else {
    clearTimeout(hostExitTimer)
    hostExitTimer = null
  }
  const becameUsable = !hostUsable(previous) && hostUsable(info)
  hostInfo = info
  if (!win || win.isDestroyed()) return
  if (hostUsable(info)) {
    if (changed && !dragOrigin) {
      const size = windowSize()
      const current = win.getBounds()
      const target = settings.position
        ? { ...current, ...size, x: info.x + settings.position.x, y: info.y + settings.position.y }
        : { ...current, ...size, x: info.x + info.width - size.width - 12, y: info.y + info.height - size.height - 12 }
      syncing = true
      win.setBounds(clampToHost(target), false)
      syncing = false
    }
    if (launcherWin && !launcherWin.isDestroyed()) {
      if (changed) launcherWin.setBounds(launcherBounds(info), false)
      if (changed || !launcherWin.isVisible()) {
        launcherWin.showInactive()
        launcherWin.moveTop()
      }
    }
    if (!widgetDismissed && (changed || !win.isVisible())) win.showInactive()
  } else {
    if ((changed || win.isVisible()) && !win.isDestroyed()) win.hide()
    if (launcherWin && !launcherWin.isDestroyed() && (changed || launcherWin.isVisible())) launcherWin.hide()
  }
  if (changed) sendState()
  if (becameUsable && !widgetDismissed) refreshQuota()
}

function stopHostTracker() {
  if (hostTracker) hostTracker.kill()
  hostTracker = null
}

function startHostTracker() {
  stopHostTracker()
  if (!win || win.isDestroyed() || !launcherWin || launcherWin.isDestroyed()) return
  const handle = win.getNativeWindowHandle().readBigUInt64LE(0).toString()
  const launcherHandle = launcherWin.getNativeWindowHandle().readBigUInt64LE(0).toString()
  const child = spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'scripts', 'host-window.ps1'),
    '-WidgetHandle', handle, '-LauncherHandle', launcherHandle, '-HostMode', settings.hostMode,
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  hostTracker = child
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    try { updateHost(JSON.parse(line)) } catch {}
  })
  child.stderr.resume()
  child.on('error', () => updateHost({ found: false, visible: false }))
  child.on('exit', () => {
    if (hostTracker !== child) return
    hostTracker = null
    updateHost({ found: false, visible: false })
  })
}

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    return
  }
  settingsWindow = new BrowserWindow({
    parent: win,
    width: 430,
    height: 700,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: 'Kimi 娘挂件设置',
    backgroundColor: '#18192b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
    },
  })
  settingsWindow.setMenuBarVisibility(false)
  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'))
  settingsWindow.on('closed', () => { settingsWindow = null })
}

function createMenu() {
  return Menu.buildFromTemplate([
    { label: '刷新额度', click: () => refreshQuota() },
    { label: '挂件设置', click: () => openSettings() },
    { type: 'separator' },
    { label: '宿主边缘吸附', type: 'checkbox', checked: settings.edgeSnap, click: (item) => {
      settings.edgeSnap = item.checked
      saveSettings()
      if (item.checked) snapWindow()
    } },
    { label: '演示模式', type: 'checkbox', checked: state.demo, click: (item) => {
      state.demo = item.checked
      refreshQuota()
    } },
    { type: 'separator' },
    { label: '打开 Kimi Code 控制台', click: () => shell.openExternal('https://www.kimi.com/code/console') },
    { label: '退出 Kimi 娘（保留快速入口）', click: () => dismissWidget() },
  ])
}

async function refreshQuota() {
  if (activeRequest) return activeRequest
  const sequence = ++requestSequence
  state.loading = true
  state.error = null
  sendState()
  activeRequest = (async () => {
    try {
      if (state.demo) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        state.quotas = demoQuota()
      } else {
        state.quotas = await fetchQuota()
        store.saveCache({ quotas: state.quotas, updatedAt: new Date().toISOString() })
      }
      state.updatedAt = new Date().toISOString()
      state.stale = false
      firstAuthFailureAt = null
    } catch (error) {
      if (sequence !== requestSequence) return publicState()
      const cache = state.demo ? null : store.loadCache()
      if (cache?.quotas) {
        state.quotas = cache.quotas
        state.updatedAt = cache.updatedAt
      }
      state.stale = Boolean(cache?.quotas)
      const cacheSuffix = state.stale ? '；当前显示上次成功快照' : ''
      if (error.code === 'AUTH_FAILED') {
        firstAuthFailureAt ??= Date.now()
        if (Date.now() - firstAuthFailureAt >= AUTH_FAILURE_GRACE_MS) {
          state.error = `${error.message}${cacheSuffix}`
        } else {
          state.error = state.stale ? null : '正在同步登录状态，请稍候'
        }
      } else {
        state.error = `${error.message || '额度查询失败'}${cacheSuffix}`
      }
    } finally {
      if (sequence === requestSequence) {
        state.loading = false
        activeRequest = null
        sendState()
      }
    }
    return publicState()
  })()
  return activeRequest
}

function createWindow() {
  win = new BrowserWindow({
    ...windowSize(),
    x: 0,
    y: 0,
    useContentSize: true,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  })
  win.setAlwaysOnTop(false)
  win.setMenuBarVisibility(false)
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  win.once('ready-to-show', () => {
    if (hostUsable(hostInfo)) win.showInactive()
    sendState()
  })
  win.on('moved', () => {
    if (snapping || syncing || dragOrigin) return
    savePosition()
    saveSettings()
    snapWindow()
  })
  win.webContents.on('context-menu', () => createMenu().popup({ window: win }))
  win.on('closed', () => { win = null })
}

function createLauncher() {
  launcherWin = new BrowserWindow({
    width: LAUNCHER_WIDTH,
    height: LAUNCHER_HEIGHT,
    x: 0,
    y: 0,
    useContentSize: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
      backgroundThrottling: false,
    },
  })
  launcherWin.setAlwaysOnTop(false)
  launcherWin.setMenuBarVisibility(false)
  launcherWin.loadFile(path.join(__dirname, 'renderer', 'launcher.html'))
  launcherWin.on('closed', () => { launcherWin = null })
}

ipcMain.on('widget:reveal', (event) => {
  if (launcherWin && event.sender.id === launcherWin.webContents.id) revealWidget()
})

ipcMain.on('widget:mouse-pass-through', (event, ignore) => {
  if (!win || win.isDestroyed() || event.sender.id !== win.webContents.id) return
  win.setIgnoreMouseEvents(Boolean(ignore), { forward: Boolean(ignore) })
})

let launcherDragOrigin = null
function validPoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y)
}
ipcMain.on('launcher:drag-start', (event, point) => {
  if (!launcherWin || event.sender.id !== launcherWin.webContents.id || !validPoint(point)) return
  launcherDragOrigin = { point, bounds: launcherWin.getBounds() }
})
ipcMain.on('launcher:drag-move', (event, point) => {
  if (!launcherWin || !launcherDragOrigin || event.sender.id !== launcherWin.webContents.id || !validPoint(point)) return
  const bounds = {
    ...launcherDragOrigin.bounds,
    x: launcherDragOrigin.bounds.x + Math.round(point.x - launcherDragOrigin.point.x),
    y: launcherDragOrigin.bounds.y + Math.round(point.y - launcherDragOrigin.point.y),
  }
  if (hostUsable(hostInfo)) {
    launcherWin.setBounds({
      ...bounds,
      x: Math.max(hostInfo.x + 2, Math.min(bounds.x, hostInfo.x + hostInfo.width - LAUNCHER_WIDTH - 2)),
      y: Math.max(hostInfo.y + 2, Math.min(bounds.y, hostInfo.y + hostInfo.height - LAUNCHER_HEIGHT - 2)),
    }, false)
  }
})
ipcMain.on('launcher:drag-end', (event) => {
  if (!launcherWin || event.sender.id !== launcherWin.webContents.id) return
  launcherDragOrigin = null
  saveLauncherPosition()
  saveSettings()
})

let dragOrigin = null
ipcMain.on('widget:drag-start', (event, point) => {
  if (!win || event.sender.id !== win.webContents.id || !validPoint(point)) return
  dragOrigin = { point, bounds: win.getBounds() }
})
ipcMain.on('widget:drag-move', (event, point) => {
  if (!win || !dragOrigin || event.sender.id !== win.webContents.id || !validPoint(point)) return
  const bounds = {
    ...dragOrigin.bounds,
    x: dragOrigin.bounds.x + Math.round(point.x - dragOrigin.point.x),
    y: dragOrigin.bounds.y + Math.round(point.y - dragOrigin.point.y),
  }
  win.setBounds(clampToHost(bounds), false)
})
ipcMain.on('widget:drag-end', (event) => {
  if (!win || event.sender.id !== win.webContents.id) return
  dragOrigin = null
  savePosition()
  saveSettings()
  snapWindow()
})

function handleNotification(message) {
  if (message?.type !== 'task-completed') return
  const now = Date.now()
  if (now - lastCompletionAt < 1200) return
  lastCompletionAt = now
  if (win && !win.isDestroyed()) {
    win.webContents.send('widget:sound', { kind: 'complete', source: String(message.source || 'kimi') })
  }
}

function startNotificationBridge() {
  notificationServer = net.createServer((socket) => {
    let input = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      input += chunk
      if (input.length > 4096) socket.destroy()
    })
    socket.on('end', () => {
      try { handleNotification(JSON.parse(input)) } catch {}
    })
    socket.on('error', () => {})
  })
  notificationServer.on('error', () => {})
  notificationServer.listen(PIPE_NAME)
}

function trustedSender(event) {
  return (win && event.sender.id === win.webContents.id) ||
    (settingsWindow && event.sender.id === settingsWindow.webContents.id)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => revealWidget())
  app.whenReady().then(() => {
    store = new SettingsStore(app.getPath('userData'))
    settings = store.load()
    state.demo = state.demo || settings.demo
    const cache = store.loadCache()
    if (!state.demo && cache?.quotas) {
      state.quotas = cache.quotas
      state.updatedAt = cache.updatedAt
    }
    ipcMain.handle('widget:get-state', () => publicState())
    ipcMain.handle('widget:get-settings', () => publicSettings())
    ipcMain.handle('widget:update-settings', (event, patch) => {
      if (!trustedSender(event) || !patch || typeof patch !== 'object') return publicSettings()
      const allowed = ['hostMode', 'characterScale', 'panelScale', 'autoCloseMs', 'clickSound',
        'clickSoundPreset', 'clickVolume', 'completionSound', 'completionVolume']
      const update = {}
      for (const key of allowed) {
        if (Object.hasOwn(patch, key)) update[key] = patch[key]
      }
      const previousHostMode = settings.hostMode
      settings = normalizeSettings({ ...settings, ...update })
      if (settings.hostMode !== previousHostMode) startHostTracker()
      else applyLayout()
      saveSettings()
      return publicSettings()
    })
    ipcMain.handle('widget:open-settings', (event) => {
      if (win && event.sender.id === win.webContents.id) openSettings()
    })
    ipcMain.handle('widget:play-sound', (event, kind) => {
      if (!trustedSender(event) || !['press', 'release', 'complete'].includes(kind)) return
      if (win && !win.isDestroyed()) win.webContents.send('widget:sound', { kind, source: 'preview' })
    })
    ipcMain.handle('widget:refresh', () => refreshQuota())
    ipcMain.handle('widget:set-demo', (_event, enabled) => {
      state.demo = Boolean(enabled)
      return refreshQuota()
    })
    createWindow()
    createLauncher()
    startHostTracker()
    startNotificationBridge()
    powerMonitor.on('resume', () => refreshQuota())
    powerMonitor.on('unlock-screen', () => refreshQuota())
    refreshQuota()
    refreshTimer = setInterval(() => {
      if (win && !win.isDestroyed() && win.isVisible()) refreshQuota()
    }, 60000)
  })
}

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => {
  clearInterval(refreshTimer)
  clearTimeout(saveTimer)
  clearTimeout(hostExitTimer)
  notificationServer?.close()
  stopHostTracker()
  if (settings && hostUsable(hostInfo)) savePosition()
  store?.save(settings)
})
