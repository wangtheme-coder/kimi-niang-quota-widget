const revealButton = document.querySelector('#reveal')
let drag = null
let suppressClick = false

revealButton.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  drag = { id: event.pointerId, startX: event.screenX, startY: event.screenY, moved: false }
  revealButton.setPointerCapture(event.pointerId)
  window.kimiWidget.launcherDragStart({ x: event.screenX, y: event.screenY })
})
revealButton.addEventListener('pointermove', (event) => {
  if (!drag || drag.id !== event.pointerId) return
  if (Math.hypot(event.screenX - drag.startX, event.screenY - drag.startY) > 4) drag.moved = true
  if (drag.moved) {
    event.preventDefault()
    window.kimiWidget.launcherDragMove({ x: event.screenX, y: event.screenY })
  }
})
function finishDrag(event) {
  if (!drag || (event && drag.id !== event.pointerId)) return
  suppressClick = drag.moved
  drag = null
  if (event && revealButton.hasPointerCapture(event.pointerId)) revealButton.releasePointerCapture(event.pointerId)
  window.kimiWidget.launcherDragEnd()
  if (suppressClick) setTimeout(() => { suppressClick = false }, 0)
}
revealButton.addEventListener('pointerup', finishDrag)
revealButton.addEventListener('pointercancel', () => finishDrag())
revealButton.addEventListener('click', () => {
  if (suppressClick) {
    suppressClick = false
    return
  }
  window.kimiWidget.revealWidget()
})
