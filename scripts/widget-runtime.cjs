const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

function electronEnvironment() {
  const env = { ...process.env }
  // 某些宿主（实测有）会把 ELECTRON_RUN_AS_NODE=1 留在环境里，带着它启动 Electron 会变成
  // 纯 Node 模式，窗口起不来；这里统一清掉，保证 GUI 进程正常。
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

function startWidget() {
  const child = spawn(electronPath, [root], {
    detached: true,
    stdio: 'ignore',
    cwd: root,
    env: electronEnvironment(),
    windowsHide: true,
  })
  child.unref()
}

function launchWidget() {
  if (fs.existsSync(electronPath)) {
    startWidget()
    return 'started'
  }
  const installer = path.join(__dirname, 'install-widget-runtime.cjs')
  const child = spawn(process.execPath, [installer], {
    detached: true,
    stdio: 'ignore',
    cwd: root,
    windowsHide: true,
  })
  child.unref()
  return 'preparing'
}

module.exports = { electronPath, launchWidget, root, startWidget }
