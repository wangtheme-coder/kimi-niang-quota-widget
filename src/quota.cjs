const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const USAGE_URL = 'https://api.kimi.com/coding/v1/usages'
const MEMBERSHIP_STATS_URL = 'https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats'
const MEMBERSHIP_SUB_URL = 'https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscription'
// 老套餐（如 Andante）的月度额度池不在 coding /usages 接口里，需要从 Kimi 桌面客户端
// 本机 localStorage 读取 kimi.com 网页会话令牌，调用会员服务接口读取 amountUsedRatio。
// 令牌只在内存中使用，不写入设置、缓存或日志。
const WEB_TOKEN_LEVELDB_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'kimi-desktop', 'Local Storage', 'leveldb'
)
const WEB_JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
const MONTHLY_KEYS = new Set(['monthly', 'month', 'monthlyusage', 'monthly_usage', '30d', 'days30', 'monthlyquota'])
const ROLLING_KEYS = new Set(['rolling', 'fivehour', 'five_hour', '5h', 'hourly', 'usage'])

function numberAt(object, keys) {
  for (const key of keys) {
    const value = object?.[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  }
  return null
}

function resetAt(object) {
  const value = object?.resetAt ?? object?.resetTime ?? object?.resetsAt ?? object?.reset_at ?? object?.reset_time ?? object?.nextResetTime ?? object?.endTime ?? object?.end_time
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
    const numeric = Number(value)
    if (numeric > 1e12) return new Date(numeric).toISOString()
    if (numeric > 1e9) return new Date(numeric * 1000).toISOString()
  }
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  return null
}

function parseWindow(object, force = {}) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return null
  const source = object.detail && typeof object.detail === 'object' ? object.detail
    : object.usage && typeof object.usage === 'object' && !force.monthly ? object.usage : object
  const limit = numberAt(source, ['limit', 'total', 'quota', 'totalLimit', 'total_limit'])
  const remaining = numberAt(source, ['remaining', 'remain', 'left', 'available'])
  const used = numberAt(source, ['used', 'usageUsed', 'usage_used', 'consumed'])
  let usedPercent = numberAt(source, ['usedPercent', 'used_percent', 'usedPercentage', 'usagePercent', 'usage_percent', 'percentageUsed'])
  const usedRatio = numberAt(source, ['used_ratio', 'usedRatio', 'usage_ratio', 'usageRatio'])
  const remainingPercent = numberAt(source, ['remainingPercent', 'remaining_percent', 'remainPercent', 'remainingPercentage'])
  if (usedPercent === null && usedRatio !== null) usedPercent = usedRatio * 100
  if (usedPercent === null && remainingPercent !== null) usedPercent = 100 - remainingPercent
  if (usedPercent === null && used !== null && limit > 0) usedPercent = used / limit * 100
  if (usedPercent === null && remaining !== null && limit > 0) usedPercent = (limit - remaining) / limit * 100
  if (usedPercent === null) usedPercent = numberAt(source, ['percentage', 'percent'])
  if (!Number.isFinite(usedPercent)) return null
  return {
    available: true,
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    remaining,
    limit,
    resetAt: resetAt(source) || resetAt(object),
  }
}

function durationKind(object) {
  const window = object?.window && typeof object.window === 'object' ? object.window : object
  const minutes = numberAt(window, ['windowMinutes', 'window_minutes', 'durationMinutes', 'duration_minutes', 'minutes', 'duration'])
  const seconds = numberAt(window, ['windowSeconds', 'window_seconds', 'durationSeconds', 'duration_seconds', 'seconds'])
  const milliseconds = numberAt(window, ['windowMs', 'window_ms', 'durationMs', 'duration_ms'])
  if (minutes !== null) {
    if (Math.abs(minutes - 300) <= 1) return 'fiveHour'
    if (Math.abs(minutes - 43200) <= 60) return 'monthly'
  }
  if (seconds !== null) {
    if (Math.abs(seconds - 18000) <= 60) return 'fiveHour'
    if (Math.abs(seconds - 2592000) <= 3600) return 'monthly'
  }
  if (milliseconds !== null) {
    if (Math.abs(milliseconds - 18000000) <= 60000) return 'fiveHour'
    if (Math.abs(milliseconds - 2592000000) <= 3600000) return 'monthly'
  }
  return null
}

function parseQuotaPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('额度接口返回了无法识别的数据')
  const root = payload.data && typeof payload.data === 'object' ? payload.data : payload
  let fiveHour = parseWindow(root.usages?.limit_5h) || parseWindow(root.usage) || parseWindow(root.fiveHour) || parseWindow(root.rolling)
  let monthly = parseWindow(root.usages?.limit_month_total)
  const sevenDay = parseWindow(root.usages?.limit_7d)

  function visit(node, key = '', depth = 0) {
    if (!node || typeof node !== 'object' || depth > 6) return
    if (!Array.isArray(node)) {
      const normalized = key.toLowerCase()
      const kind = durationKind(node) || (MONTHLY_KEYS.has(normalized) ? 'monthly' : ROLLING_KEYS.has(normalized) ? 'fiveHour' : null)
      if (kind === 'monthly' && !monthly) monthly = parseWindow(node, { monthly: true })
      if (kind === 'fiveHour' && !fiveHour) fiveHour = parseWindow(node)
      if (monthly && fiveHour) return
    }
    for (const [childKey, child] of Object.entries(node)) {
      if (child && typeof child === 'object') visit(child, childKey, depth + 1)
    }
  }
  visit(root)
  if (!fiveHour && !monthly && !sevenDay) throw new Error('接口返回成功，但没有识别到额度窗口')
  return {
    fiveHour: fiveHour || { available: false, reason: '接口未返回 5 小时窗口' },
    monthly: monthly
      || (sevenDay ? { ...sevenDay, label: '7 天限额' } : { available: false, reason: '接口未返回 30 天窗口' }),
  }
}

function tokenFrom(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) return null
  for (const key of ['access_token', 'accessToken']) {
    if (typeof value[key] === 'string' && value[key].length > 10) return value[key]
  }
  for (const [key, child] of Object.entries(value)) {
    if (/refresh|secret|expires|scope/i.test(key)) continue
    if (key === 'token' && typeof child === 'string' && child.length > 20) return child
    if (child && typeof child === 'object') {
      const token = tokenFrom(child, depth + 1)
      if (token) return token
    }
  }
  return null
}

function readAccessToken() {
  if (process.env.KIMI_CODING_KEY) return process.env.KIMI_CODING_KEY.trim()
  const home = process.env.KIMI_CODE_HOME || path.join(os.homedir(), '.kimi-code')
  const directory = path.join(home, 'credentials')
  let files = []
  try {
    files = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => {
        const file = path.join(directory, entry.name)
        return { file, mtime: fs.statSync(file).mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)
  } catch {
    throw new Error('未找到 Kimi Code 登录状态，请先在 Kimi Code 中登录')
  }
  for (const { file } of files) {
    try {
      const token = tokenFrom(JSON.parse(fs.readFileSync(file, 'utf8')))
      if (token) return token
    } catch {
    }
  }
  throw new Error('未找到可用的 Kimi Code 登录令牌，请重新登录')
}

async function requestQuota(token) {
  let response
  try {
    response = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    })
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error('额度查询超时，请稍后重试')
    throw new Error('无法连接 Kimi 额度服务，请检查网络')
  }
  if (response.status === 401 || response.status === 403) return null
  if (response.status === 429) throw new Error('查询过于频繁，请稍后重试')
  if (!response.ok) throw new Error(`额度服务暂时不可用（HTTP ${response.status}）`)
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error('额度接口返回了非 JSON 数据')
  }
  return parseQuotaPayload(payload)
}

async function fetchCodingQuota() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1200))
    const quotas = await requestQuota(readAccessToken())
    if (quotas) return quotas
  }
  const error = new Error('登录状态已失效，请在 Kimi Code 中重新登录')
  error.code = 'AUTH_FAILED'
  throw error
}

// 网页 access_token 约 30 分钟有效，桌面客户端会自动轮换并写入 localStorage；
// 每次查询重新扫描即可无缝跟随，轮换间隙由 7 天窗口兜底。
function candidateWebTokens() {
  let files = []
  try {
    files = fs.readdirSync(WEB_TOKEN_LEVELDB_DIR)
      .filter((name) => name.endsWith('.log') || name.endsWith('.ldb'))
  } catch {
    return []
  }
  const found = new Set()
  const now = Math.floor(Date.now() / 1000)
  for (const name of files) {
    let buffer
    try {
      buffer = fs.readFileSync(path.join(WEB_TOKEN_LEVELDB_DIR, name))
    } catch {
      continue
    }
    for (const encoding of ['latin1', 'utf16le']) {
      const text = buffer.toString(encoding)
      let match
      while ((match = WEB_JWT_RE.exec(text)) !== null) {
        try {
          const payload = JSON.parse(Buffer.from(match[0].split('.')[1], 'base64url').toString('utf8'))
          if (payload.type === 'refresh' || payload.typ === 'refresh') continue
          if ((payload.exp || 0) > now + 90) found.add(match[0])
        } catch {
        }
      }
    }
  }
  return [...found]
}

async function postMembership(url, token) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: '{}',
    signal: AbortSignal.timeout(12000),
  })
  if (response.status !== 200) return null
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function fetchMembershipMonthly() {
  for (const token of candidateWebTokens()) {
    const stats = await postMembership(MEMBERSHIP_STATS_URL, token).catch(() => null)
    const balance = stats && stats.subscriptionBalance
    // 注意：不能写 Number(balance && balance.amountUsedRatio)，401 时 balance 为 null，
    // Number(null) === 0 会被当成合法比例，必须显式判断类型。
    const ratio = balance && typeof balance.amountUsedRatio === 'number' ? balance.amountUsedRatio : NaN
    if (!Number.isFinite(ratio)) continue
    const subscription = await postMembership(MEMBERSHIP_SUB_URL, token).catch(() => null)
    const sub = subscription && subscription.subscription
    const resetValue = sub && (sub.nextBillingTime || sub.currentEndTime)
    const resetAtIso = typeof resetValue === 'string' && Number.isFinite(Date.parse(resetValue))
      ? new Date(resetValue).toISOString()
      : null
    return {
      available: true,
      usedPercent: Math.max(0, Math.min(100, ratio * 100)),
      remaining: null,
      limit: null,
      resetAt: resetAtIso,
      label: '月度额度池',
    }
  }
  return null
}

async function fetchQuota() {
  const quotas = await fetchCodingQuota()
  // 7 天兜底也带 available: true，需要用 label 区分它是不是真实月度窗口：
  // 只有拿到真实月度（limit_month_total 或会员接口月度池）才不再尝试会员接口。
  const monthlyIsReal = quotas.monthly && quotas.monthly.available && quotas.monthly.label !== '7 天限额'
  if (!monthlyIsReal) {
    const membershipMonthly = await fetchMembershipMonthly().catch(() => null)
    if (membershipMonthly) quotas.monthly = membershipMonthly
  }
  return quotas
}

function demoQuota() {
  return {
    fiveHour: { available: true, usedPercent: 37, remaining: 63000, limit: 100000,
      resetAt: new Date(Date.now() + 2.4 * 3600000).toISOString() },
    monthly: { available: true, usedPercent: 68, remaining: 640000, limit: 2000000,
      resetAt: new Date(Date.now() + 12.5 * 86400000).toISOString() },
  }
}

module.exports = { fetchQuota, parseQuotaPayload, demoQuota, tokenFrom }
