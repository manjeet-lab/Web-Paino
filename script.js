/* ============================================================
   Web Piano / Harmonium — script.js
   Web Audio API · GSAP · Vanilla JS
   ============================================================ */

// ──────────────────────────────────────────────
// 1. AUDIO CONTEXT SETUP
// ──────────────────────────────────────────────

let audioCtx = null;
let masterGain = null;
let reverbNode = null;
let reverbEnabled = false;
let sustainEnabled = false;

// Active oscillators: noteId → { osc, gainNode, isSustaining }
const activeNotes = new Map();

/** Lazily create (or resume) AudioContext on first user interaction */
function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.7;
    masterGain.connect(audioCtx.destination);
    buildReverb();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

/** Build a synthetic impulse response for reverb */
function buildReverb() {
  reverbNode = audioCtx.createConvolver();
  const sampleRate = audioCtx.sampleRate;
  const duration = 2.5;
  const decay = 2.0;
  const length = Math.floor(sampleRate * duration);
  const impulse = audioCtx.createBuffer(2, length, sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  reverbNode.buffer = impulse;
  reverbNode.connect(masterGain);
}

// ──────────────────────────────────────────────
// 2. NOTE FREQUENCY CALCULATION
// ──────────────────────────────────────────────

function getNoteFrequency(note, octave, transpose = 0) {
  const noteOrder = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const semitone = noteOrder.indexOf(note) + octave * 12 + transpose;
  return 440 * Math.pow(2, (semitone - 57) / 12);
}

// ──────────────────────────────────────────────
// 3. PLAY / STOP NOTE
// ──────────────────────────────────────────────

function playNote(noteId, frequency) {
  getAudioCtx();
  if (activeNotes.has(noteId)) return;

  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);

  gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
  gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.01);

  osc.connect(gainNode);
  if (reverbEnabled && reverbNode) {
    gainNode.connect(reverbNode);
  } else {
    gainNode.connect(masterGain);
  }
  osc.start();

  activeNotes.set(noteId, { osc, gainNode, isSustaining: false });
  updateNoteDisplay(noteId, frequency);
}

function stopNote(noteId, force = false) {
  if (!activeNotes.has(noteId)) return;
  if (sustainEnabled && !force) {
    activeNotes.get(noteId).isSustaining = true;
    return;
  }
  releaseNote(noteId);
}

function releaseNote(noteId) {
  if (!activeNotes.has(noteId)) return;
  const { osc, gainNode } = activeNotes.get(noteId);
  const now = audioCtx.currentTime;
  const releaseTime = sustainEnabled ? 1.2 : 0.25;
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(gainNode.gain.value, now);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime);
  osc.stop(now + releaseTime + 0.05);
  activeNotes.delete(noteId);
  if (activeNotes.size === 0) clearNoteDisplay();
}

function releaseAllSustained() {
  for (const [noteId, entry] of activeNotes.entries()) {
    if (entry.isSustaining) releaseNote(noteId);
  }
}

// ──────────────────────────────────────────────
// 4. APP STATE
// ──────────────────────────────────────────────

let currentOctave = 4;
let currentTranspose = 0;

// ──────────────────────────────────────────────
// 5. PIANO LAYOUT DEFINITION
// ──────────────────────────────────────────────

const WHITE_NOTES = ['C','D','E','F','G','A','B'];
const BLACK_NOTES = [
  { note: 'C#', afterWhite: 0 },
  { note: 'D#', afterWhite: 1 },
  { note: 'F#', afterWhite: 3 },
  { note: 'G#', afterWhite: 4 },
  { note: 'A#', afterWhite: 5 },
];

const WHITE_SHORTCUTS = ['Q','W','E','R','T','Y','U'];
const BLACK_SHORTCUTS = ['2','3','5','6','7'];

const WKW = 52;   // white key width
const WKH = 180;  // white key height
const BKW = 32;   // black key width
const BKH = 110;  // black key height

// ──────────────────────────────────────────────
// 6. RENDER KEYBOARD — Two-layer approach
//    Layer 1: white keys as inline-block in a flex row
//    Layer 2: black keys as an absolute-positioned overlay
// ──────────────────────────────────────────────

const keyboardEl = document.getElementById('piano-keyboard');

function buildKeyboard() {
  const octaves = [currentOctave - 1, currentOctave, currentOctave + 1];

  keyboardEl.innerHTML = '';

  // The outer wrapper holds both layers
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    position: relative;
    display: inline-flex;
    height: ${WKH}px;
  `;

  // ── Layer 1: White keys (flex row) ──
  const whiteLayer = document.createElement('div');
  whiteLayer.style.cssText = `
    position: relative;
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    height: ${WKH}px;
    z-index: 1;
  `;

  // ── Layer 2: Black key overlay (absolute, same size as white layer) ──
  const blackLayer = document.createElement('div');
  blackLayer.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: ${BKH}px;
    z-index: 10;
    pointer-events: none;
  `;

  octaves.forEach((oct, octIdx) => {
    const isShortcutOctave = (octIdx === 1);
    const octaveStartX = octIdx * WHITE_NOTES.length * WKW;

    // White keys
    WHITE_NOTES.forEach((note, wi) => {
      const noteId = `${note}${oct}`;
      const key = document.createElement('div');

      key.dataset.note = note;
      key.dataset.octave = oct;
      key.style.cssText = `
        width: ${WKW}px;
        height: ${WKH}px;
        background: linear-gradient(to bottom, #f0eeff 0%, #ffffff 40%, #f8f6ff 100%);
        border: 1px solid #b0a8d0;
        border-top: none;
        border-radius: 0 0 6px 6px;
        cursor: pointer;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-end;
        padding-bottom: 10px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.9);
        transition: background 0.05s;
        user-select: none;
        position: relative;
        z-index: 1;
      `;

      const labelEl = document.createElement('div');
      labelEl.style.cssText = 'font-size: 10px; font-weight: 600; color: #8b82b8; line-height: 1;';
      labelEl.textContent = note;

      const shortcutEl = document.createElement('div');
      shortcutEl.style.cssText = 'font-size: 9px; color: #a89ccc; margin-top: 2px;';
      if (isShortcutOctave) shortcutEl.textContent = WHITE_SHORTCUTS[wi] || '';

      key.appendChild(labelEl);
      key.appendChild(shortcutEl);
      whiteLayer.appendChild(key);

      key.addEventListener('mousedown', (e) => { e.preventDefault(); handleKeyDown(noteId, note, oct, key); });
      key.addEventListener('mouseup', () => handleKeyUp(noteId, key));
      key.addEventListener('mouseleave', () => handleKeyUp(noteId, key));
      key.addEventListener('touchstart', (e) => { e.preventDefault(); handleKeyDown(noteId, note, oct, key); }, { passive: false });
      key.addEventListener('touchend', (e) => { e.preventDefault(); handleKeyUp(noteId, key); });
    });

    // Black keys
    BLACK_NOTES.forEach((bk, bi) => {
      const noteId = `${bk.note}${oct}`;
      const leftX = octaveStartX + (bk.afterWhite + 1) * WKW - Math.round(BKW / 2);

      const key = document.createElement('div');
      key.dataset.note = bk.note;
      key.dataset.octave = oct;
      key.style.cssText = `
        position: absolute;
        left: ${leftX}px;
        top: 0px;
        width: ${BKW}px;
        height: ${BKH}px;
        background: linear-gradient(to bottom, #252038 0%, #18122e 55%, #100b1f 100%);
        border: 1px solid #4a3880;
        border-top: none;
        border-radius: 0 0 6px 6px;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-end;
        padding-bottom: 8px;
        box-shadow: 2px 5px 10px rgba(0,0,0,0.95), inset 1px 0 0 rgba(120,100,200,0.15), inset -1px 0 0 rgba(120,100,200,0.1), inset 0 1px 0 rgba(160,140,230,0.2);
        transition: background 0.05s;
        pointer-events: all;
        user-select: none;
        z-index: 10;
      `;

      const labelEl = document.createElement('div');
      labelEl.style.cssText = 'font-size: 8px; font-weight: 700; color: #9888d8; line-height: 1;';
      labelEl.textContent = bk.note;

      const shortcutEl = document.createElement('div');
      shortcutEl.style.cssText = 'font-size: 7px; color: #6a60a8; margin-top: 2px;';
      if (isShortcutOctave) shortcutEl.textContent = BLACK_SHORTCUTS[bi] || '';

      key.appendChild(labelEl);
      key.appendChild(shortcutEl);
      blackLayer.appendChild(key);

      key.addEventListener('mousedown', (e) => { e.preventDefault(); handleKeyDown(noteId, bk.note, oct, key); });
      key.addEventListener('mouseup', () => handleKeyUp(noteId, key));
      key.addEventListener('mouseleave', () => handleKeyUp(noteId, key));
      key.addEventListener('touchstart', (e) => { e.preventDefault(); handleKeyDown(noteId, bk.note, oct, key); }, { passive: false });
      key.addEventListener('touchend', (e) => { e.preventDefault(); handleKeyUp(noteId, key); });
    });
  });

  wrapper.appendChild(whiteLayer);
  wrapper.appendChild(blackLayer);
  keyboardEl.appendChild(wrapper);
}

// ──────────────────────────────────────────────
// 7. KEY INTERACTION HANDLERS
// ──────────────────────────────────────────────

function handleKeyDown(noteId, note, octave, keyEl) {
  const freq = getNoteFrequency(note, octave, currentTranspose);
  playNote(noteId, freq);
  pressVisual(keyEl, note.includes('#'));
}

function handleKeyUp(noteId, keyEl) {
  stopNote(noteId);
  releaseVisual(keyEl, keyEl?.dataset?.note?.includes('#'));
}

function pressVisual(keyEl, isBlack) {
  if (!keyEl) return;
  if (isBlack) {
    keyEl.style.background = 'linear-gradient(to bottom, #6b5bc4 0%, #5a4ab0 55%, #4a3a99 100%)';
    keyEl.style.boxShadow = '1px 2px 5px rgba(0,0,0,0.95), inset 0 2px 5px rgba(0,0,0,0.4)';
    keyEl.style.transform = 'translateY(2px)';
  } else {
    keyEl.style.background = 'linear-gradient(to bottom, #c4bfff 0%, #a89cff 40%, #b8aeff 100%)';
    keyEl.style.boxShadow = '0 2px 4px rgba(0,0,0,0.5), inset 0 2px 4px rgba(0,0,0,0.15)';
    keyEl.style.transform = 'translateY(2px)';
  }
  gsap.to(keyEl, { scaleY: 0.97, duration: 0.05, ease: 'power2.out', transformOrigin: 'top center' });
}

function releaseVisual(keyEl, isBlack) {
  if (!keyEl) return;
  if (isBlack) {
    keyEl.style.background = 'linear-gradient(to bottom, #252038 0%, #18122e 55%, #100b1f 100%)';
    keyEl.style.boxShadow = '2px 5px 10px rgba(0,0,0,0.95), inset 1px 0 0 rgba(120,100,200,0.15), inset -1px 0 0 rgba(120,100,200,0.1), inset 0 1px 0 rgba(160,140,230,0.2)';
    keyEl.style.transform = '';
  } else {
    keyEl.style.background = 'linear-gradient(to bottom, #f0eeff 0%, #ffffff 40%, #f8f6ff 100%)';
    keyEl.style.boxShadow = '0 4px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.9)';
    keyEl.style.transform = '';
  }
  gsap.to(keyEl, { scaleY: 1, duration: 0.12, ease: 'elastic.out(1, 0.4)', transformOrigin: 'top center' });
}

// ──────────────────────────────────────────────
// 8. KEYBOARD SHORTCUT MAPPING
// ──────────────────────────────────────────────

const KEY_MAP = {};
WHITE_SHORTCUTS.forEach((k, i) => { KEY_MAP[k.toLowerCase()] = { note: WHITE_NOTES[i], isBlack: false }; });
BLACK_SHORTCUTS.forEach((k, i) => { KEY_MAP[k] = { note: BLACK_NOTES[i].note, isBlack: true }; });

const pressedKeys = new Set();

document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const key = e.key.toLowerCase();
  const rawKey = e.key;

  if (key === 'z') { changeOctave(-1); return; }
  if (key === 'x') { changeOctave(1); return; }

  if (rawKey === ' ') {
    e.preventDefault();
    sustainEnabled = true;
    document.getElementById('sustain-toggle').style.background = '#4a3f8f';
    document.getElementById('sustain-toggle').style.borderColor = '#7c6af7';
    document.getElementById('sustain-toggle').style.color = '#d4ceff';
    return;
  }

  const mapping = KEY_MAP[key] || KEY_MAP[rawKey];
  if (!mapping) return;
  if (pressedKeys.has(rawKey)) return;
  pressedKeys.add(rawKey);

  const oct = currentOctave;
  const noteId = `${mapping.note}${oct}`;
  const keyEl = getKeyElement(mapping.note, oct);
  handleKeyDown(noteId, mapping.note, oct, keyEl);
});

document.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  const rawKey = e.key;

  if (rawKey === ' ') {
    sustainEnabled = false;
    document.getElementById('sustain-toggle').style.background = '';
    document.getElementById('sustain-toggle').style.borderColor = '';
    document.getElementById('sustain-toggle').style.color = '';
    releaseAllSustained();
    return;
  }

  const mapping = KEY_MAP[key] || KEY_MAP[rawKey];
  if (!mapping) return;
  pressedKeys.delete(rawKey);

  const oct = currentOctave;
  const noteId = `${mapping.note}${oct}`;
  const keyEl = getKeyElement(mapping.note, oct);
  handleKeyUp(noteId, keyEl);
});

function getKeyElement(note, octave) {
  return keyboardEl.querySelector(`[data-note="${note}"][data-octave="${octave}"]`);
}

// ──────────────────────────────────────────────
// 9. CONTROLS
// ──────────────────────────────────────────────

// Volume
const volumeSlider = document.getElementById('volume-slider');
const volumeValue = document.getElementById('volume-value');
volumeSlider.addEventListener('input', () => {
  const vol = volumeSlider.value / 100;
  if (masterGain) masterGain.gain.setTargetAtTime(vol, audioCtx?.currentTime ?? 0, 0.01);
  volumeValue.textContent = `${volumeSlider.value}%`;
});

// Octave
function changeOctave(delta) {
  currentOctave = Math.max(1, Math.min(7, currentOctave + delta));
  document.getElementById('octave-display').textContent = currentOctave;
  buildKeyboard();
  const el = document.getElementById('octave-display');
  gsap.fromTo(el, { scale: 1.4, color: '#9b8cf9' }, { scale: 1, color: '#c4beff', duration: 0.3, ease: 'back.out(2)' });
}

document.getElementById('octave-up').addEventListener('click', () => changeOctave(1));
document.getElementById('octave-down').addEventListener('click', () => changeOctave(-1));

// Transpose
function changeTranspose(delta) {
  currentTranspose = Math.max(-12, Math.min(12, currentTranspose + delta));
  const el = document.getElementById('transpose-display');
  el.textContent = currentTranspose >= 0 ? `+${currentTranspose}` : `${currentTranspose}`;
  gsap.fromTo(el, { scale: 1.4, color: '#9b8cf9' }, { scale: 1, color: '#c4beff', duration: 0.3, ease: 'back.out(2)' });
}

document.getElementById('transpose-up').addEventListener('click', () => changeTranspose(1));
document.getElementById('transpose-down').addEventListener('click', () => changeTranspose(-1));

// Reverb
document.getElementById('reverb-toggle').addEventListener('click', function () {
  getAudioCtx();
  reverbEnabled = !reverbEnabled;
  if (reverbEnabled) {
    this.style.background = '#4a3f8f';
    this.style.borderColor = '#7c6af7';
    this.style.color = '#d4ceff';
    this.style.boxShadow = '0 0 12px rgba(124, 106, 247, 0.35)';
  } else {
    this.style.background = '';
    this.style.borderColor = '';
    this.style.color = '';
    this.style.boxShadow = '';
  }
  gsap.fromTo(this, { scale: 0.92 }, { scale: 1, duration: 0.2, ease: 'back.out(2)' });
});

// Sustain toggle (click)
document.getElementById('sustain-toggle').addEventListener('click', function () {
  sustainEnabled = !sustainEnabled;
  if (sustainEnabled) {
    this.style.background = '#4a3f8f';
    this.style.borderColor = '#7c6af7';
    this.style.color = '#d4ceff';
    this.style.boxShadow = '0 0 12px rgba(124, 106, 247, 0.35)';
  } else {
    this.style.background = '';
    this.style.borderColor = '';
    this.style.color = '';
    this.style.boxShadow = '';
    releaseAllSustained();
  }
});

// ──────────────────────────────────────────────
// 10. NOTE DISPLAY
// ──────────────────────────────────────────────

function updateNoteDisplay(noteId, frequency) {
  const el = document.getElementById('note-display');
  const freqEl = document.getElementById('freq-display');
  el.textContent = noteId;
  freqEl.textContent = `${frequency.toFixed(1)} Hz`;
  gsap.fromTo(el, { scale: 1.3, color: '#c4beff' }, { scale: 1, color: '#7c6af7', duration: 0.25, ease: 'back.out(2)' });
}

function clearNoteDisplay() {
  const el = document.getElementById('note-display');
  gsap.to(el, {
    opacity: 0.4, duration: 0.5, onComplete: () => {
      el.textContent = '—';
      document.getElementById('freq-display').textContent = '0 Hz';
      gsap.to(el, { opacity: 1, duration: 0.2 });
    }
  });
}

// ──────────────────────────────────────────────
// 11. DEMO MELODY — Für Elise opening
// ──────────────────────────────────────────────

const DEMO_MELODY = [
  { note: 'E',  oct: 5, dur: 0.18 },
  { note: 'D#', oct: 5, dur: 0.18 },
  { note: 'E',  oct: 5, dur: 0.18 },
  { note: 'D#', oct: 5, dur: 0.18 },
  { note: 'E',  oct: 5, dur: 0.18 },
  { note: 'B',  oct: 4, dur: 0.18 },
  { note: 'D',  oct: 5, dur: 0.18 },
  { note: 'C',  oct: 5, dur: 0.18 },
  { note: 'A',  oct: 4, dur: 0.38 },
  { note: 'C',  oct: 4, dur: 0.18 },
  { note: 'E',  oct: 4, dur: 0.18 },
  { note: 'A',  oct: 4, dur: 0.18 },
  { note: 'B',  oct: 4, dur: 0.38 },
  { note: 'E',  oct: 4, dur: 0.18 },
  { note: 'G#', oct: 4, dur: 0.18 },
  { note: 'B',  oct: 4, dur: 0.18 },
  { note: 'C',  oct: 5, dur: 0.38 },
  { note: 'E',  oct: 4, dur: 0.18 },
  { note: 'E',  oct: 5, dur: 0.18 },
  { note: 'D#', oct: 5, dur: 0.18 },
  { note: 'E',  oct: 5, dur: 0.18 },
  { note: 'D#', oct: 5, dur: 0.18 },
  { note: 'E',  oct: 5, dur: 0.18 },
  { note: 'B',  oct: 4, dur: 0.18 },
  { note: 'D',  oct: 5, dur: 0.18 },
  { note: 'C',  oct: 5, dur: 0.18 },
  { note: 'A',  oct: 4, dur: 0.55 },
];

let demoRunning = false;
const demoTimers = [];

document.getElementById('demo-btn').addEventListener('click', function () {
  if (demoRunning) { stopDemo(); return; }
  startDemo();
});

function startDemo() {
  getAudioCtx();
  demoRunning = true;
  document.getElementById('demo-btn').textContent = '⏹ Stop Demo';

  let delay = 0;
  DEMO_MELODY.forEach((step, idx) => {
    const t1 = setTimeout(() => {
      if (!demoRunning) return;
      const noteId = `demo_${step.note}${step.oct}`;
      const freq = getNoteFrequency(step.note, step.oct, 0);
      const keyEl = getKeyElement(step.note, step.oct);
      playNote(noteId, freq);
      if (keyEl) pressVisual(keyEl, step.note.includes('#'));

      const t2 = setTimeout(() => {
        stopNote(noteId, true);
        if (keyEl) releaseVisual(keyEl, step.note.includes('#'));
      }, step.dur * 800);
      demoTimers.push(t2);
    }, delay * 1000);
    demoTimers.push(t1);
    delay += step.dur + 0.04;

    if (idx === DEMO_MELODY.length - 1) {
      const t3 = setTimeout(() => {
        demoRunning = false;
        document.getElementById('demo-btn').textContent = '▶ Demo Melody';
      }, (delay + 0.5) * 1000);
      demoTimers.push(t3);
    }
  });
}

function stopDemo() {
  demoRunning = false;
  demoTimers.forEach(clearTimeout);
  demoTimers.length = 0;
  document.getElementById('demo-btn').textContent = '▶ Demo Melody';
  for (const [noteId] of activeNotes.entries()) {
    if (noteId.startsWith('demo_')) releaseNote(noteId);
  }
}

// ──────────────────────────────────────────────
// 12. ENTRANCE ANIMATION
// ──────────────────────────────────────────────

function animateEntrance() {
  gsap.from('#piano-keyboard', { y: 30, opacity: 0, duration: 0.7, ease: 'power3.out', delay: 0.1 });
}

// ──────────────────────────────────────────────
// 13. INIT
// ──────────────────────────────────────────────

buildKeyboard();
animateEntrance();
document.getElementById('transpose-display').textContent = '+0';
