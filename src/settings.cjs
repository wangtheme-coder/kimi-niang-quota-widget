const fs = require('node:fs')
const path = require('node:path')

const DEFAULTS = {
  hostMode: 'auto',
  edgeSnap: true,
  side: 'right',
  characterScale: 1,
  panelScale: 1,
  autoCloseMs: 10000,
  clickSound: true,
  clickSoundPreset: 'duck',
  clickVolume: 0.45,
  completionSound: true,
  completionVolume: 0.65,
  demo: false,
  position: null,
  launcherPosition: null,
}

function scale(value, fallback) {
  return Number.isFinite(value) && value >= 0.8 && value <= 1.5 ? value : fallback
}

function volume(value, fallback) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback
}

function normalizeSettings(value = {}) {
  const legacyScale = scale(value.scale, 1)
  const normalized = {
    ...DEFAULTS,
    ...value,
    characterScale: scale(value.characterScale, legacyScale),
    panelScale: scale(value.panelScale, legacyScale),
    autoCloseMs: [0, 5000, 10000, 30000].includes(value.autoCloseMs) ? value.autoCloseMs : 10000,
    clickSound: value.clickSound !== false,
    clickSoundPreset: ['duck', 'electronic'].includes(value.clickSoundPreset) ? value.clickSoundPreset : 'duck',
    clickVolume: volume(value.clickVolume, DEFAULTS.clickVolume),
    completionSound: value.completionSound !== false,
    completionVolume: volume(value.completionVolume, DEFAULTS.completionVolume),
    side: value.side === 'left' ? 'left' : 'right',
    hostMode: ['auto', 'code', 'kimi'].includes(value.hostMode) ? value.hostMode : 'auto',
    edgeSnap: value.edgeSnap !== false,
    position: Number.isFinite(value.position?.x) && Number.isFinite(value.position?.y)
      ? { x: value.position.x, y: value.position.y }
      : null,
    launcherPosition: Number.isFinite(value.launcherPosition?.xRatio) && Number.isFinite(value.launcherPosition?.yRatio)
      ? {
          xRatio: Math.max(0, Math.min(1, value.launcherPosition.xRatio)),
          yRatio: Math.max(0, Math.min(1, value.launcherPosition.yRatio)),
        }
      : null,
  }
  delete normalized.scale
  delete normalized.alwaysOnTop
  delete normalized.bounds
  return normalized
}

class SettingsStore {
  constructor(directory) {
    this.directory = directory
    this.file = path.join(directory, 'settings.json')
    this.cacheFile = path.join(directory, 'quota-cache.json')
  }

  load() {
    return normalizeSettings(this.readJson(this.file) || {})
  }

  loadCache() {
    const value = this.readJson(this.cacheFile)
    if (!value?.quotas || !value?.updatedAt || Number.isNaN(Date.parse(value.updatedAt))) return null
    return value
  }

  saveCache(value) {
    this.writeJson(this.cacheFile, value)
  }

  save(value) {
    if (!value) return
    this.writeJson(this.file, { ...value, scale: undefined, demo: undefined })
  }

  readJson(file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      return null
    }
  }

  writeJson(file, value) {
    try {
      fs.mkdirSync(this.directory, { recursive: true })
      const temporary = `${file}.${process.pid}.tmp`
      fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
      fs.renameSync(temporary, file)
    } catch {
    }
  }
}

module.exports = { SettingsStore, normalizeSettings }
