const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { electronPath, root, startWidget } = require('./widget-runtime.cjs')

const dataDirectory = process.env.KIMI_NIANG_DATA_DIR || path.join(process.env.APPDATA || os.homedir(), 'kimi-niang-quota-widget')
const lockPath = path.join(dataDirectory, 'runtime-install.lock')
const logPath = path.join(dataDirectory, 'runtime-install.log')
let ownsLock = false

function acquireLock() {
  fs.mkdirSync(dataDirectory, { recursive: true })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' })
      ownsLock = true
      return true
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      let active = true
      try {
        const pid = Number(fs.readFileSync(lockPath, 'utf8'))
        if (pid) process.kill(pid, 0)
      } catch (readError) {
        active = readError.code === 'EPERM'
      }
      if (active) return false
      fs.unlinkSync(lockPath)
    }
  }
  return false
}

function installRuntime() {
  return new Promise((resolve, reject) => {
    const log = fs.openSync(logPath, 'a')
    // 从 npm 装进来的包里不含 package-lock.json（npm 发布时会剔除），这时退回 install。
    const hasLock = fs.existsSync(path.join(root, 'package-lock.json'))
    const args = hasLock
      ? ['ci', '--no-audit', '--no-fund', '--loglevel=error']
      : ['install', '--no-audit', '--no-fund', '--loglevel=error']
    const windows = process.platform === 'win32'
    const command = windows ? (process.env.ComSpec || 'cmd.exe') : 'npm'
    const commandArgs = windows ? ['/d', '/s', '/c', 'npm', ...args] : args
    let child
    try {
      child = spawn(command, commandArgs, {
        cwd: root,
        stdio: ['ignore', log, log],
        windowsHide: true,
      })
    } catch (error) {
      fs.closeSync(log)
      reject(error)
      return
    }
    child.on('error', reject)
    child.on('exit', (code) => resolve(code === 0))
    fs.closeSync(log)
  })
}

async function main() {
  if (fs.existsSync(electronPath)) {
    startWidget()
    return
  }
  if (!acquireLock()) return
  try {
    if (fs.existsSync(electronPath) || await installRuntime()) {
      if (fs.existsSync(electronPath)) startWidget()
    }
  } finally {
    if (ownsLock) fs.unlinkSync(lockPath)
  }
}

main().catch((error) => {
  fs.mkdirSync(dataDirectory, { recursive: true })
  fs.appendFileSync(logPath, `\n${error.stack || error}\n`)
}).finally(() => {
  if (ownsLock && fs.existsSync(lockPath)) {
    try { fs.unlinkSync(lockPath) } catch {}
  }
})
