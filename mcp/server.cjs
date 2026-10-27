const readline = require('node:readline')
const { fetchQuota } = require('../src/quota.cjs')
const { launchWidget } = require('../scripts/widget-runtime.cjs')
const { version } = require('../package.json')

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
      const status = launchWidget()
      return textResult(status === 'started'
        ? 'Kimi 娘桌面挂件已启动或呼出。'
        : '首次使用正在准备桌面组件，完成后会自动打开 Kimi 娘；额度查询现在即可使用。')
    } catch (error) {
      return textResult(`桌面组件启动失败：${error.message || '未知错误'}`, true)
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
      serverInfo: { name: 'kimi-niang-quota', version },
    } })
    return
  }
  if (message.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: message.id, result: { tools: [
      { name: 'get_quota', description: '只读查询当前 Kimi Code 账号的 5 小时和 30 天额度，不创建聊天或模型请求', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'open_widget', description: '启动或呼出 Kimi 娘桌面挂件；首次使用会自动准备桌面组件', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
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
