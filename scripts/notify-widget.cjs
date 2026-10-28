const net = require('node:net')

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input)
    if (payload.hook_event_name !== 'Notification') process.exit(0)
    const message = {
      type: 'task-completed',
      source: String(payload.client_type || 'kimi').slice(0, 60),
      event: 'background-task',
      sessionTitle: String(payload.session_title || '').slice(0, 120),
    }
    const socket = net.connect('\\\\.\\pipe\\kimi-niang-quota')
    socket.setTimeout(1000, () => {
      socket.destroy()
      process.exit(0)
    })
    socket.on('error', () => process.exit(0))
    socket.on('connect', () => socket.end(JSON.stringify(message), () => process.exit(0)))
  } catch {
    process.exit(0)
  }
})
process.stdin.resume()
