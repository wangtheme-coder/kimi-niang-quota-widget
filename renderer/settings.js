const fields = {
  hostMode: document.querySelector('#host-mode'),
  characterScale: document.querySelector('#character-scale'),
  panelScale: document.querySelector('#panel-scale'),
  autoCloseMs: document.querySelector('#auto-close'),
  clickSound: document.querySelector('#click-sound'),
  clickVolume: document.querySelector('#click-volume'),
  completionSound: document.querySelector('#completion-sound'),
  completionVolume: document.querySelector('#completion-volume'),
}

function renderOutputs() {
  document.querySelector('#character-value').textContent = `${fields.characterScale.value}%`
  document.querySelector('#panel-value').textContent = `${fields.panelScale.value}%`
  document.querySelector('#click-volume-value').textContent = `${fields.clickVolume.value}%`
  document.querySelector('#completion-volume-value').textContent = `${fields.completionVolume.value}%`
}

function render(settings) {
  fields.hostMode.value = settings.hostMode
  fields.characterScale.value = Math.round(settings.characterScale * 100)
  fields.panelScale.value = Math.round(settings.panelScale * 100)
  fields.autoCloseMs.value = String(settings.autoCloseMs)
  fields.clickSound.checked = settings.clickSound
  fields.clickVolume.value = Math.round(settings.clickVolume * 100)
  fields.completionSound.checked = settings.completionSound
  fields.completionVolume.value = Math.round(settings.completionVolume * 100)
  renderOutputs()
}

function readForm() {
  return {
    hostMode: fields.hostMode.value,
    characterScale: Number(fields.characterScale.value) / 100,
    panelScale: Number(fields.panelScale.value) / 100,
    autoCloseMs: Number(fields.autoCloseMs.value),
    clickSound: fields.clickSound.checked,
    clickVolume: Number(fields.clickVolume.value) / 100,
    completionSound: fields.completionSound.checked,
    completionVolume: Number(fields.completionVolume.value) / 100,
  }
}

let updateFrame = 0
let updatePromise = Promise.resolve()
let lastSubmitted = ''
function submit() {
  const patch = readForm()
  lastSubmitted = JSON.stringify(patch)
  updatePromise = window.kimiWidget.updateSettings(patch)
  return updatePromise
}

function update() {
  renderOutputs()
  if (!updateFrame) {
    updateFrame = requestAnimationFrame(() => {
      updateFrame = 0
      submit()
    })
  }
}

for (const field of Object.values(fields)) {
  field.addEventListener(field.type === 'range' ? 'input' : 'change', update)
}
document.querySelectorAll('[data-preview]').forEach((button) => {
  button.addEventListener('click', async () => {
    if (updateFrame) cancelAnimationFrame(updateFrame)
    updateFrame = 0
    await submit()
    await window.kimiWidget.playSound(button.dataset.preview)
  })
})
document.querySelector('#close').addEventListener('click', () => window.close())
window.kimiWidget.getSettings().then(render)
window.kimiWidget.onSettings((settings) => {
  if (JSON.stringify(readForm()) !== lastSubmitted) render(settings)
})
