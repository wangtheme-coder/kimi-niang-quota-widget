let audioContext = null

function tone(context, frequency, start, duration, volume, endFrequency = frequency) {
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(frequency, start)
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), start + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start(start)
  oscillator.stop(start + duration + 0.02)
}

async function playSound(kind, { enabled = true, volume = 0.5 } = {}) {
  if (!enabled || volume <= 0) return false
  try {
    audioContext ||= new AudioContext()
    if (audioContext.state === 'suspended') await audioContext.resume()
    const now = audioContext.currentTime + 0.01
    if (kind === 'complete') {
      tone(audioContext, 523.25, now, 0.24, volume * 0.16)
      tone(audioContext, 659.25, now + 0.09, 0.25, volume * 0.15)
      tone(audioContext, 783.99, now + 0.18, 0.32, volume * 0.14)
    } else if (kind === 'release') {
      tone(audioContext, 620, now, 0.075, volume * 0.12, 480)
    } else {
      tone(audioContext, 420, now, 0.055, volume * 0.1, 540)
    }
    return true
  } catch {
    return false
  }
}

window.playKimiSound = playSound
