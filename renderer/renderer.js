const bubble = document.querySelector('#bubble')
const character = document.querySelector('#character')
const characterImage = document.querySelector('#character-image')
const refreshButton = document.querySelector('#refresh')
const sourceLabel = document.querySelector('#source')
const statusLabel = document.querySelector('#status')
const updatedLabel = document.querySelector('#updated')
const onlineDot = document.querySelector('#online-dot')
let latestState = null
let expanded = false
let resetTimer = null
let collapseTimer = null
let pointerOverCharacter = false
let mousePassThrough = false

characterImage.addEventListener('load', () => character.classList.add('has-image'))
characterImage.addEventListener('error', () => character.classList.remove('has-image'))
if (characterImage.complete && characterImage.naturalWidth) character.classList.add('has-image')

function scheduleCollapse() {
  clearTimeout(collapseTimer)
  const delay = latestState?.autoCloseMs ?? 10000
  if (expanded && delay > 0) collapseTimer = setTimeout(() => setExpanded(false), delay)
}

function updateMousePassThrough() {
  const ignore = !expanded && !pointerOverCharacter
  if (mousePassThrough === ignore) return
  mousePassThrough = ignore
  window.kimiWidget.setMousePassThrough(ignore)
}

function setExpanded(value) {
  expanded = value
  bubble.classList.toggle('open', value)
  bubble.setAttribute('aria-hidden', String(!value))
  character.setAttribute('aria-expanded', String(value))
  updateMousePassThrough()
  scheduleCollapse()
}

character.addEventListener('pointerenter', () => {
  pointerOverCharacter = true
  updateMousePassThrough()
})
character.addEventListener('pointerleave', () => {
  pointerOverCharacter = false
  updateMousePassThrough()
})

function playLocalSound(kind) {
  const completion = kind === 'complete'
  return window.playKimiSound(kind, {
    enabled: completion ? latestState?.completionSound !== false : latestState?.clickSound !== false,
    volume: completion ? latestState?.completionVolume ?? 1 : latestState?.clickVolume ?? 1,
    preset: latestState?.clickSoundPreset || 'duck',
  })
}

bubble.addEventListener('pointerdown', () => {
  if (expanded) scheduleCollapse()
})
window.kimiWidget.onSound(({ kind }) => playLocalSound(kind))

let drag = null
let suppressClick = false
character.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  playLocalSound('press')
  drag = { id: event.pointerId, startX: event.screenX, startY: event.screenY, moved: false }
  character.setPointerCapture(event.pointerId)
  window.kimiWidget.dragStart({ x: event.screenX, y: event.screenY })
})
character.addEventListener('pointermove', (event) => {
  if (!drag || drag.id !== event.pointerId) return
  if (Math.hypot(event.screenX - drag.startX, event.screenY - drag.startY) > 4) drag.moved = true
  if (drag.moved) {
    event.preventDefault()
    window.kimiWidget.dragMove({ x: event.screenX, y: event.screenY })
  }
})
character.addEventListener('pointerup', (event) => {
  if (!drag || drag.id !== event.pointerId) return
  playLocalSound('release')
  suppressClick = drag.moved
  drag = null
  character.releasePointerCapture(event.pointerId)
  window.kimiWidget.dragEnd()
  if (suppressClick) setTimeout(() => { suppressClick = false }, 0)
})
character.addEventListener('pointercancel', () => {
  suppressClick = Boolean(drag?.moved)
  drag = null
  window.kimiWidget.dragEnd()
  if (suppressClick) setTimeout(() => { suppressClick = false }, 0)
})
character.addEventListener('click', () => {
  if (suppressClick) {
    suppressClick = false
    return
  }
  setExpanded(!expanded)
})
refreshButton.addEventListener('click', async () => {
  if (expanded) scheduleCollapse()
  refreshButton.disabled = true
  refreshButton.classList.add('loading')
  try { await window.kimiWidget.refresh() } finally {
    refreshButton.disabled = false
    refreshButton.classList.remove('loading')
  }
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setExpanded(false)
  if (event.key === 'F5') refreshButton.click()
})

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0))
}

function formatAmount(value) {
  if (!Number.isFinite(value)) return ''
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return String(Math.round(value))
}

function formatReset(resetAt) {
  if (!resetAt) return ''
  const time = new Date(resetAt).getTime()
  if (!Number.isFinite(time)) return ''
  const remaining = time - Date.now()
  if (remaining <= 0) return '等待重置刷新'
  const minutes = Math.floor(remaining / 60000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days) return `${days}天${hours}时后重置`
  if (hours) return `${hours}时${mins}分后重置`
  return `${Math.max(1, mins)}分后重置`
}

function renderQuota(key, quota) {
  const root = document.querySelector(`#quota-${key}`)
  const percent = root.querySelector('.percent')
  const fill = root.querySelector('.fill')
  const track = root.querySelector('.track')
  const remaining = root.querySelector('.remaining')
  const reset = root.querySelector('.reset')
  root.classList.toggle('unavailable', !quota?.available)

  if (!quota?.available) {
    percent.textContent = '--'
    fill.style.width = '0'
    fill.className = 'fill'
    track.removeAttribute('aria-valuenow')
    remaining.textContent = quota?.reason || '接口未返回此窗口'
    reset.textContent = ''
    return
  }

  const value = clampPercent(quota.usedPercent)
  const displayValue = value > 0 && value < 10 ? value.toFixed(1) : String(Math.round(value))
  percent.textContent = `${displayValue}%`
  fill.style.width = `${value}%`
  fill.className = `fill${value >= 90 ? ' danger' : value >= 75 ? ' warning' : ''}`
  track.setAttribute('aria-valuenow', value.toFixed(1))
  if (Number.isFinite(quota.remaining) && Number.isFinite(quota.limit)) {
    remaining.textContent = `剩余 ${formatAmount(quota.remaining)} / ${formatAmount(quota.limit)}`
  } else {
    remaining.textContent = `剩余 ${Math.max(0, 100 - value).toFixed(value > 90 ? 1 : 0)}%`
  }
  reset.dataset.resetAt = quota.resetAt || ''
  reset.textContent = formatReset(quota.resetAt)
}

function render(state) {
  const previousAutoClose = latestState?.autoCloseMs
  latestState = state
  const fitScale = state.fitScale || 1
  document.documentElement.style.setProperty('--character-scale', (state.characterScale || 1) * fitScale)
  document.documentElement.style.setProperty('--panel-scale', (state.panelScale || 1) * fitScale)
  document.querySelector('#widget').classList.toggle('side-left', state.side === 'left')
  if (expanded && previousAutoClose !== state.autoCloseMs) scheduleCollapse()
  renderQuota('5h', state.quotas?.fiveHour)
  renderQuota('30d', state.quotas?.monthly)
  sourceLabel.textContent = state.demo ? '演示数据' : 'Kimi Code'
  sourceLabel.style.color = state.demo ? '#ffd178' : ''
  statusLabel.textContent = state.error || (state.demo ? '仅演示界面，不是账号额度' : '额度已更新')
  const updated = state.updatedAt ? new Date(state.updatedAt) : null
  const isToday = updated?.toDateString() === new Date().toDateString()
  updatedLabel.textContent = updated
    ? updated.toLocaleString('zh-CN', isToday
      ? { hour: '2-digit', minute: '2-digit' }
      : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : ''
  updatedLabel.title = updated ? `成功快照：${updated.toLocaleString('zh-CN')}` : ''
  onlineDot.className = `online-dot ${state.error ? 'error' : state.loading ? '' : 'ok'}`
  refreshButton.classList.toggle('loading', Boolean(state.loading))
  document.querySelectorAll('.reset').forEach((element) => {
    element.textContent = formatReset(element.dataset.resetAt)
  })
}

character.addEventListener('contextmenu', () => setExpanded(true))
updateMousePassThrough()
window.kimiWidget.getState().then(render).catch((error) => {
  statusLabel.textContent = error.message || '挂件初始化失败'
  onlineDot.className = 'online-dot error'
})
window.kimiWidget.onState(render)
window.kimiWidget.onReveal(() => setExpanded(true))
window.addEventListener('online', () => window.kimiWidget.refresh())
resetTimer = setInterval(() => {
  if (latestState) render(latestState)
}, 60000)
window.addEventListener('beforeunload', () => clearInterval(resetTimer))
