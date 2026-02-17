/**
 * Audio Notification Service
 * Provides functional ringtones and notification sounds
 */

class AudioNotificationService {
  constructor() {
    this.audioContext = null;
    this.sounds = {};
    this.isEnabled = true;
    this.volume = 0.7;
    this.loadedSounds = new Set();
    this.initAudioContext();
  }

  // Initialize Web Audio API context
  initAudioContext() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioContext = new AudioContext();
      }
    } catch (err) {
      console.warn('Audio Context not supported:', err);
    }
  }

  // Preload notification sounds
  preloadSounds() {
    const soundMap = {
      // Incoming call ringtone
      incomingCall: this.generateRingtone('call'),
      // Message notification
      messageNotification: this.generateRingtone('message'),
      // Member joined
      memberJoined: this.generateRingtone('join'),
      // Member left
      memberLeft: this.generateRingtone('leave'),
      // Call ended
      callEnded: this.generateRingtone('end'),
      // Alert sound
      alert: this.generateRingtone('alert')
    };

    this.sounds = soundMap;
    return soundMap;
  }

  // Generate synthetic ringtone using Web Audio API
  generateRingtone(type) {
    if (!this.audioContext) return null;

    const ctx = this.audioContext;
    let duration = 2;
    let frequencies = [440, 494]; // A4, B4

    switch (type) {
      case 'call':
        // Classic phone ringtone pattern (double burst)
        duration = 3;
        frequencies = [950, 1400]; // Higher frequencies for call
        break;
      case 'message':
        // Short beep for message
        duration = 0.5;
        frequencies = [800];
        break;
      case 'join':
        // Ascending tones for join
        frequencies = [523, 659, 784]; // C5, E5, G5
        duration = 1;
        break;
      case 'leave':
        // Descending tones for leave
        frequencies = [784, 659, 523]; // G5, E5, C5
        duration = 1;
        break;
      case 'end':
        // Two short beeps
        duration = 0.6;
        frequencies = [600, 400];
        break;
      case 'alert':
        duration = 0.8;
        frequencies = [1200, 800];
        break;
      default:
        break;
    }

    return { type, duration, frequencies };
  }

  // Play notification sound
  async playSound(soundType) {
    if (!this.isEnabled || !this.audioContext) return false;

    try {
      // Resume audio context if suspended (required after user interaction)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const sound = this.sounds[soundType];
      if (!sound) {
        console.warn(`Sound type not found: ${soundType}`);
        return false;
      }

      // Use Web Audio API to generate the sound
      this.playSynthSound(sound);
      return true;
    } catch (err) {
      console.error('Error playing sound:', err);
      return false;
    }
  }

  // Play synthesized sound using oscillators
  playSynthSound(sound) {
    const ctx = this.audioContext;
    if (!ctx) return;

    const now = ctx.currentTime;
    const duration = sound.duration;
    const { frequencies, type } = sound;

    // Create master gain node
    const masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
    masterGain.gain.setValueAtTime(this.volume, now);
    masterGain.gain.exponentialRampToValueAtTime(0.01, now + duration);

    // Play frequencies with pattern
    if (type === 'call' || type === 'end') {
      // Pulse pattern
      const patternDuration = duration / 3;
      frequencies.forEach((freq, i) => {
        setTimeout(() => {
          this.playTone(freq, patternDuration, masterGain);
        }, i * (patternDuration + 0.1) * 1000);
      });
    } else if (type === 'join' || type === 'leave') {
      // Sequential ascending/descending
      const stepDuration = duration / frequencies.length;
      frequencies.forEach((freq, i) => {
        const startTime = now + (i * stepDuration);
        this.playToneAtTime(freq, stepDuration, masterGain, startTime);
      });
    } else {
      // Single tone
      this.playTone(frequencies[0], duration, masterGain);
    }
  }

  // Play a single tone
  playTone(frequency, duration, destNode) {
    const ctx = this.audioContext;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.frequency.setValueAtTime(frequency, now);
    osc.type = 'sine';

    gain.gain.setValueAtTime(0.3 * this.volume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

    osc.connect(gain);
    gain.connect(destNode);

    osc.start(now);
    osc.stop(now + duration);
  }

  // Play tone at specific time
  playToneAtTime(frequency, duration, destNode, startTime) {
    const ctx = this.audioContext;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.frequency.setValueAtTime(frequency, startTime);
    osc.type = 'sine';

    gain.gain.setValueAtTime(0.3 * this.volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

    osc.connect(gain);
    gain.connect(destNode);

    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  // Play notification sound with repeat pattern
  async playRingtone(soundType, count = 3) {
    if (!this.isEnabled) return false;

    let played = false;
    for (let i = 0; i < count; i++) {
      if (await this.playSound(soundType)) {
        played = true;
        // Wait between repeats
        if (i < count - 1) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
    }
    return played;
  }

  // Stop all sounds
  stopAllSounds() {
    if (!this.audioContext) return;
    try {
      // Stop all oscillators by suspending the context
      this.audioContext.suspend().then(() => {
        this.audioContext.resume();
      });
    } catch (err) {
      console.warn('Error stopping sounds:', err);
    }
  }

  // Enable/disable notifications
  setEnabled(enabled) {
    this.isEnabled = enabled;
  }

  // Set volume (0-1)
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  // Get current volume
  getVolume() {
    return this.volume;
  }

  // Check if audio is supported
  isSupported() {
    return this.audioContext !== null;
  }
}

// Create singleton instance
let audioNotificationInstance = null;

export const getAudioNotificationService = () => {
  if (!audioNotificationInstance) {
    audioNotificationInstance = new AudioNotificationService();
    audioNotificationInstance.preloadSounds();
  }
  return audioNotificationInstance;
};

export default AudioNotificationService;
