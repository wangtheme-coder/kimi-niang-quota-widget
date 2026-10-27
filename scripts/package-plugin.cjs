const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const manifest = require('../kimi.plugin.json')
const packageJson = require('../package.json')

const root = path.resolve(__dirname, '..')
const outputDirectory = path.join(root, 'dist')
const output = path.join(outputDirectory, `kimi-niang-quota-widget-v${manifest.version}.zip`)
const files = [
  'kimi.plugin.json',
  'package.json',
  'package-lock.json',
  'marketplace.json',
  'main.cjs',
  'preload.cjs',
  'README.md',
  'LICENSE',
  'NOTICE.md',
  'assets',
  'commands',
  'docs',
  'mcp',
  'renderer',
  'scripts',
  'src',
]

if (manifest.version !== packageJson.version) {
  throw new Error('kimi.plugin.json 与 package.json 的版本不一致')
}
for (const file of files) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`发布文件缺失：${file}`)
}

// 收集条目：目录递归展开，一律用 `/` 分隔、按路径排序，保证同样的源码打出同样的字节。
function collect(relativePath) {
  const absolute = path.join(root, relativePath)
  const stat = fs.statSync(absolute)
  if (stat.isDirectory()) {
    return fs.readdirSync(absolute).sort().flatMap((name) => collect(`${relativePath}/${name}`))
  }
  return [relativePath]
}

const entries = [...new Set(files.flatMap((file) => collect(file)))].sort()

// 固定日期（DOS 时间最小可表示年 1980），不写入任何本地时间戳，ZIP 因此可复现。
const DOS_TIME = 0
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1

const localParts = []
const centralParts = []
let offset = 0

for (const name of entries) {
  const data = fs.readFileSync(path.join(root, name))
  const deflated = zlib.deflateRawSync(data, { level: 9 })
  const useDeflate = deflated.length < data.length
  const payload = useDeflate ? deflated : data
  const method = useDeflate ? 8 : 0
  const nameBuffer = Buffer.from(name, 'utf8')
  const crc = typeof zlib.crc32 === 'function' ? zlib.crc32(data) >>> 0 : crc32Fallback(data)

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4) // version needed
  local.writeUInt16LE(0x0800, 6) // UTF-8 文件名
  local.writeUInt16LE(method, 8)
  local.writeUInt16LE(DOS_TIME, 10)
  local.writeUInt16LE(DOS_DATE, 12)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(payload.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(nameBuffer.length, 26)
  local.writeUInt16LE(0, 28)

  localParts.push(local, nameBuffer, payload)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0x0800, 8)
  central.writeUInt16LE(method, 10)
  central.writeUInt16LE(DOS_TIME, 12)
  central.writeUInt16LE(DOS_DATE, 14)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(payload.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(nameBuffer.length, 28)
  central.writeUInt16LE(0, 30) // extra
  central.writeUInt16LE(0, 32) // comment
  central.writeUInt16LE(0, 34) // disk
  central.writeUInt16LE(0, 36) // internal attrs
  central.writeUInt32LE(0o644 << 16, 38) // 普通文件权限
  central.writeUInt32LE(offset, 42)

  centralParts.push(central, nameBuffer)
  offset += local.length + nameBuffer.length + payload.length
}

const centralDirectory = Buffer.concat(centralParts)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(0, 4)
end.writeUInt16LE(0, 6)
end.writeUInt16LE(entries.length, 8)
end.writeUInt16LE(entries.length, 10)
end.writeUInt32LE(centralDirectory.length, 12)
end.writeUInt32LE(offset, 16)
end.writeUInt16LE(0, 20)

fs.mkdirSync(outputDirectory, { recursive: true })
fs.writeFileSync(output, Buffer.concat([...localParts, centralDirectory, end]))
process.stdout.write(`${output}\n${entries.length} 个文件\n`)

function crc32Fallback(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i]
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}
