const readline = require('node:readline')
const { spawn } = require('node:child_process')
const path = require('node:path')
const { fetchQuota } = require('../src/quota.cjs')

const root = path.resolve(__dirname, '..')
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function textResult(value, isError = false) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], isError }
}

async function callTool(name) {
  if (name === 'get_quota') {
    try {
      return textResult(await fetchQuota())
    } catch (error) {
      return textResult(error.message || '额度查询失败', true)
    }
  }
  if (name === 'open_widget') {
    try {
      const electron = require('electron')
      const child = spawn(electron, [root], { detached: true, stdio: 'ignore', cwd: root })
      child.unref()
      return textResult('Kimi 娘桌面挂件已启动。')
    } catch {
      return textResult('桌面组件尚未安装。请在插件目录运行 npm install 后重试。', true)
    }
  }
  return textResult(`未知工具：${name}`, true)
}

input.on('line', async (line) => {
  if (!line.trim()) return
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: {
      protocolVersion: message.params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'kimi-niang-quota', version: '0.1.0' },
    } })
    return
  }
  if (message.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: message.id, result: { tools: [
      { name: 'get_quota', description: '只读查询当前 Kimi Code 账号的 5 小时和 30 天额度，不创建聊天或模型请求', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'open_widget', description: '启动 Kimi 娘桌面挂件；首次使用需要在插件目录安装桌面依赖', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    ] } })
    return
  }
  if (message.method === 'tools/call') {
    const result = await callTool(message.params?.name)
    send({ jsonrpc: '2.0', id: message.id, result })
    return
  }
  if (message.id !== undefined) {
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } })
  }
})
