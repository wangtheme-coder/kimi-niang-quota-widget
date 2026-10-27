const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const electronPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
if (!fs.existsSync(electronPath)) process.exit(0)
const child = spawn(electronPath, [root], { detached: true, stdio: 'ignore', cwd: root, windowsHide: true })
child.unref()
