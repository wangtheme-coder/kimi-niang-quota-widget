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

function squeak(context, start, volume, release) {
  const oscillator = context.createOscillator()
  const filter = context.createBiquadFilter()
  const gain = context.createGain()
  const duration = release ? 0.11 : 0.09
  oscillator.type = 'sawtooth'
  oscillator.frequency.setValueAtTime(release ? 980 : 760, start)
  oscillator.frequency.exponentialRampToValueAtTime(release ? 560 : 390, start + duration)
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(1400, start)
  filter.Q.setValueAtTime(2.2, start)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * 0.075), start + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  oscillator.connect(filter)
  filter.connect(gain)
  gain.connect(context.destination)
  oscillator.start(start)
  oscillator.stop(start + duration + 0.02)
}

async function playSound(kind, { enabled = true, volume = 0.5, preset = 'duck' } = {}) {
  if (!enabled || volume <= 0) return false
  try {
    audioContext ||= new AudioContext()
    if (audioContext.state === 'suspended') await audioContext.resume()
    const now = audioContext.currentTime + 0.01
    if (kind === 'complete') {
      tone(audioContext, 523.25, now, 0.24, volume * 0.16)
      tone(audioContext, 659.25, now + 0.09, 0.25, volume * 0.15)
      tone(audioContext, 783.99, now + 0.18, 0.32, volume * 0.14)
    } else if (preset === 'electronic') {
      tone(audioContext, kind === 'release' ? 620 : 420, now, kind === 'release' ? 0.075 : 0.055,
        volume * (kind === 'release' ? 0.12 : 0.1), kind === 'release' ? 480 : 540)
    } else {
      squeak(audioContext, now, volume, kind === 'release')
    }
    return true
  } catch {
    return false
  }
}

window.playKimiSound = playSound
