// Game State
let currentLevel = 1;
let currentRound = 1;
const TOTAL_ROUNDS = 5;
let score = 0;
let soundEnabled = true;
let musicEnabled = true;
let isShuffling = false;
let isGuessing = false;
let roundPointsAwarded = false;

let cupsData = []; // [{ id, shape, slotEl, cupEl, posX }]
let currentShapesSetup = [];
let targetShape = null;

let pointsForLevel = { 1: 2, 2: 3, 3: 5 };
let cupsCountForLevel = { 1: 3, 2: 4, 3: 5 };

// Shapes Definition - Strictly 5 Shapes (Including Oval)
const SHAPES = [
  { name: 'circle', color: '#ef4444' },
  { name: 'triangle', color: '#22c55e' },
  { name: 'square', color: '#3b82f6' },
  { name: 'rectangle', color: '#a855f7' },
  { name: 'oval', color: '#f97316' }
];

/* ==========================================================================
   100% BULLETPROOF HTML5 + WEB AUDIO SYNTHESIZER (IPAD & GITHUB PAGES SAFE)
   Generates PCM WAV Data URIs in memory so audio plays on iOS Safari / iPad
   even if Silent Switch is ON or WebAudio is suspended!
   ========================================================================== */

function createWavDataUri(samples, sampleRate = 22050) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  
  /* RIFF identifier */
  view.setUint32(0, 0x52494646, false); // "RIFF"
  /* file length */
  view.setUint32(4, 36 + samples.length * 2, true);
  /* RIFF type */
  view.setUint32(8, 0x57415645, false); // "WAVE"
  /* format chunk identifier */
  view.setUint32(12, 0x666d7420, false); // "fmt "
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw PCM) */
  view.setUint16(20, 1, true);
  /* channel count (mono) */
  view.setUint16(22, 1, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate */
  view.setUint32(28, sampleRate * 2, true);
  /* block align */
  view.setUint16(32, 2, true);
  /* bits per sample */
  view.setUint16(34, 16, true);
  /* data chunk identifier */
  view.setUint32(36, 0x64617461, false); // "data"
  /* data chunk length */
  view.setUint32(40, samples.length * 2, true);
  
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return 'data:audio/wav;base64,' + btoa(binary);
}

// Synthesize WAV sound effect samples. freqEnd (optional) makes the pitch
// slide from freq -> freqEnd over the note, which reads as much more
// playful/cartoony than a flat static tone.
function generateToneSamples(freq, duration, type = 'sine', sampleRate = 22050, freqEnd = null) {
  const numSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(numSamples);
  const endFreq = freqEnd !== null ? freqEnd : freq;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const progress = t / duration;
    const f = freq + (endFreq - freq) * progress;
    let wave = 0;
    if (type === 'sine') {
      wave = Math.sin(2 * Math.PI * f * t);
    } else if (type === 'triangle') {
      wave = 2 * Math.abs(2 * (t * f - Math.floor(t * f + 0.5))) - 1;
    } else if (type === 'sawtooth') {
      wave = 2 * (t * f - Math.floor(t * f + 0.5));
    } else if (type === 'square') {
      wave = Math.sin(2 * Math.PI * f * t) >= 0 ? 1 : -1;
    }
    // Envelope: quick decay
    const envelope = Math.exp(-t * (4 / duration));
    samples[i] = wave * envelope * 0.5;
  }
  return samples;
}

// Mix two sample buffers together (for layering a bassline under a melody,
// or adding a shimmer harmonic on top of a note).
function mixSamples(a, b, gainA = 1, gainB = 1) {
  const len = Math.max(a.length, b.length);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = (a[i] || 0) * gainA + (b[i] || 0) * gainB;
  }
  return out;
}

// Generate Sound Effects Data URIs
const audioAssets = {};

function precalculateAudioAssets() {
  const sampleRate = 22050;

  // 1. Pop Sound - bright upward chirp (0.07s), square wave for a punchy
  // "cartoon click" instead of a flat beep.
  const popSamples = generateToneSamples(700, 0.07, 'square', sampleRate, 1100);
  audioAssets.pop = createWavDataUri(popSamples, sampleRate);

  // 2. Lift Sound - playful rising "boing" (0.18s)
  const liftSamples = generateToneSamples(350, 0.18, 'triangle', sampleRate, 750);
  audioAssets.lift = createWavDataUri(liftSamples, sampleRate);

  // 3. Shuffle Sounds - three short varied woodblock blips so repeated
  // swaps don't sound like the exact same note over and over.
  const shuffle1 = generateToneSamples(520, 0.045, 'square', sampleRate, 440);
  const shuffle2 = generateToneSamples(660, 0.045, 'square', sampleRate, 560);
  const shuffle3 = generateToneSamples(800, 0.045, 'square', sampleRate, 680);
  audioAssets.shuffle1 = createWavDataUri(shuffle1, sampleRate);
  audioAssets.shuffle2 = createWavDataUri(shuffle2, sampleRate);
  audioAssets.shuffle3 = createWavDataUri(shuffle3, sampleRate);
  audioAssets.shuffle = audioAssets.shuffle1; // fallback/default key

  // 4. Correct Sound Fanfare - quick 5-note major arpeggio with a soft
  // octave-up shimmer layered on top for sparkle.
  const correctNotes = [523.25, 659.25, 783.99, 1046.50, 1318.51];
  const correctNoteDur = 0.09;
  const correctLen = Math.floor(sampleRate * (correctNotes.length * correctNoteDur + 0.05));
  const correctSamples = new Float32Array(correctLen);
  const shimmerSamples = new Float32Array(correctLen);
  for (let i = 0; i < correctLen; i++) {
    const t = i / sampleRate;
    const noteIdx = Math.min(correctNotes.length - 1, Math.floor(t / correctNoteDur));
    const freq = correctNotes[noteIdx];
    const localT = t - noteIdx * correctNoteDur;
    const wave = Math.sin(2 * Math.PI * freq * t);
    const env = Math.exp(-localT * 9);
    correctSamples[i] = wave * env * 0.5;
    const shimmerWave = Math.sin(2 * Math.PI * freq * 2 * t);
    shimmerSamples[i] = shimmerWave * env * 0.22;
  }
  audioAssets.correct = createWavDataUri(mixSamples(correctSamples, shimmerSamples), sampleRate);

  // 5. Wrong Sound - comedic "womp womp" double slide instead of a harsh
  // buzz, so it reads as funny rather than punishing for kids.
  const wompDur = 0.22;
  const gapDur = 0.03;
  const wrongLen = Math.floor(sampleRate * (wompDur * 2 + gapDur));
  const wrongSamples = new Float32Array(wrongLen);
  for (let i = 0; i < wrongLen; i++) {
    const t = i / sampleRate;
    let wave = 0, env = 0;
    if (t < wompDur) {
      const localT = t;
      const f = 340 - (340 - 220) * (localT / wompDur);
      wave = 2 * Math.abs(2 * (t * f - Math.floor(t * f + 0.5))) - 1;
      env = Math.exp(-localT * 3) * (localT < 0.02 ? localT / 0.02 : 1);
    } else if (t < wompDur + gapDur) {
      wave = 0; env = 0;
    } else {
      const localT = t - wompDur - gapDur;
      const f = 260 - (260 - 150) * (localT / wompDur);
      wave = 2 * Math.abs(2 * (t * f - Math.floor(t * f + 0.5))) - 1;
      env = Math.exp(-localT * 3) * (localT < 0.02 ? localT / 0.02 : 1);
    }
    wrongSamples[i] = wave * env * 0.45;
  }
  audioAssets.wrong = createWavDataUri(wrongSamples, sampleRate);

  // 6. BGM Loop Track - upbeat 16-step pentatonic melody over a bouncy
  // two-note bassline, for a fuller and livelier loop than a single voice.
  const bgmLen = Math.floor(sampleRate * 3.2);
  const melodySamples = new Float32Array(bgmLen);
  const bassSamples = new Float32Array(bgmLen);

  const melodyNotes = [
    523.25, 587.33, 659.25, 783.99, 659.25, 587.33, 523.25, 659.25,
    783.99, 880.00, 783.99, 659.25, 523.25, 587.33, 659.25, 783.99
  ];
  const melodyStepDur = bgmLen / sampleRate / melodyNotes.length;
  for (let i = 0; i < bgmLen; i++) {
    const t = i / sampleRate;
    const stepIdx = Math.min(melodyNotes.length - 1, Math.floor(t / melodyStepDur));
    const freq = melodyNotes[stepIdx];
    const localT = t - stepIdx * melodyStepDur;
    const wave = Math.sin(2 * Math.PI * freq * t) * 0.7 +
      (2 * Math.abs(2 * (t * freq - Math.floor(t * freq + 0.5))) - 1) * 0.3;
    const env = Math.exp(-localT * 7);
    melodySamples[i] = wave * env * 0.2;
  }

  const bassNotes = [130.81, 130.81, 196.00, 196.00, 130.81, 130.81, 174.61, 196.00];
  const bassStepDur = bgmLen / sampleRate / bassNotes.length;
  for (let i = 0; i < bgmLen; i++) {
    const t = i / sampleRate;
    const stepIdx = Math.min(bassNotes.length - 1, Math.floor(t / bassStepDur));
    const freq = bassNotes[stepIdx];
    const localT = t - stepIdx * bassStepDur;
    const wave = Math.sin(2 * Math.PI * freq * t);
    const env = Math.exp(-localT * 3.5);
    bassSamples[i] = wave * env * 0.15;
  }

  audioAssets.bgm = createWavDataUri(mixSamples(melodySamples, bassSamples), sampleRate);
}

// Precalculate all WAV audio data URIs on script load
precalculateAudioAssets();

// Pre-created, reusable Audio elements (iOS Safari only reliably allows
// playback on elements that were "unlocked" during a direct tap — creating
// a brand new Audio() inside a setTimeout, like the shuffle pops do, gets
// silently blocked on iPhone/iPad). We create one element per sound effect
// once, unlock them all together on the first real tap, then just rewind
// and replay the same elements from then on.
const soundPool = {};
let audioUnlocked = false;

function createSoundPool() {
  Object.keys(audioAssets).forEach(key => {
    if (key === 'bgm') return; // bgm uses its own looping element (see startBGM)
    const audio = new Audio(audioAssets[key]);
    audio.preload = 'auto';
    audio.volume = 0.7;
    soundPool[key] = audio;
  });
}
createSoundPool();

// Play HTML5 Sound Effect Safely
function playDataUriSound(dataUriKey) {
  if (!soundEnabled || !soundPool[dataUriKey]) return;
  try {
    const audio = soundPool[dataUriKey];
    audio.currentTime = 0;
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch(e => {
        // Fallback Web Audio synth if HTML5 audio play is blocked
        playWebAudioFallback(dataUriKey);
      });
    }
  } catch (e) {
    playWebAudioFallback(dataUriKey);
  }
}

// BGM HTML5 Audio Element
let bgmAudio = null;
const BGM_NORMAL_VOLUME = 0.35;
const BGM_DUCKED_VOLUME = 0.08;
let bgmFadeInterval = null;

function startBGM() {
  if (!musicEnabled || !audioAssets.bgm) return;
  try {
    if (!bgmAudio) {
      bgmAudio = new Audio(audioAssets.bgm);
      bgmAudio.loop = true;
      bgmAudio.volume = BGM_NORMAL_VOLUME;
    }
    const playPromise = bgmAudio.play();
    if (playPromise !== undefined) {
      playPromise.catch(e => {
        console.log("BGM autoplay waiting for tap:", e);
      });
    }
  } catch (e) {}
}

function stopBGM() {
  if (bgmAudio) {
    bgmAudio.pause();
  }
}

// Smoothly fade the BGM to a target volume over durationMs.
function fadeBgmVolume(targetVolume, durationMs = 300) {
  if (!bgmAudio) return;
  if (bgmFadeInterval) clearInterval(bgmFadeInterval);
  const steps = 12;
  const stepTime = durationMs / steps;
  const startVolume = bgmAudio.volume;
  const delta = (targetVolume - startVolume) / steps;
  let stepCount = 0;
  bgmFadeInterval = setInterval(() => {
    stepCount++;
    bgmAudio.volume = Math.max(0, Math.min(1, startVolume + delta * stepCount));
    if (stepCount >= steps) {
      clearInterval(bgmFadeInterval);
      bgmFadeInterval = null;
      bgmAudio.volume = targetVolume;
    }
  }, stepTime);
}

// Duck the music down while the cups are actively shuffling (so it doesn't
// compete with the rapid swap sounds), then bring it back once it's time
// to guess.
function duckBGM() {
  fadeBgmVolume(BGM_DUCKED_VOLUME, 250);
}

function unduckBGM() {
  fadeBgmVolume(BGM_NORMAL_VOLUME, 400);
}

// Fallback Web Audio API Synthesizer
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playWebAudioFallback(key) {
  if (!soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    let freq = 600;
    if (key === 'pop') freq = 800;
    if (key === 'lift') freq = 500;
    if (key === 'shuffle') freq = 420;
    if (key === 'correct') freq = 1046;
    if (key === 'wrong') freq = 220;

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {}
}

// Audio Trigger Wrappers
function playPopSound() { playDataUriSound('pop'); }
function playLiftSound() { playDataUriSound('lift'); }
function playShuffleSound() {
  const variants = ['shuffle1', 'shuffle2', 'shuffle3'];
  playDataUriSound(variants[Math.floor(Math.random() * variants.length)]);
}
function playCorrectSound() { playDataUriSound('correct'); }
function playWrongSound() { playDataUriSound('wrong'); }

// Unlock all Audio on User Tap
function unlockAllAudio() {
  if (!audioUnlocked) {
    audioUnlocked = true;
    // Play+immediately pause every pooled sound during this real tap.
    // On iOS Safari this "unlocks" each element so it can be replayed
    // later from code that isn't directly inside a tap handler (e.g. the
    // setTimeout-driven shuffle sounds).
    Object.values(soundPool).forEach(audio => {
      const p = audio.play();
      if (p !== undefined) {
        p.then(() => {
          audio.pause();
          audio.currentTime = 0;
        }).catch(() => {});
      }
    });
  }
  if (musicEnabled) {
    startBGM();
  }
  getAudioContext();
}

// Render SVG Shapes
function getShapeSVG(shapeName) {
  const shapeObj = SHAPES.find(s => s.name === shapeName) || SHAPES[0];
  const color = shapeObj.color;
  
  switch(shapeName) {
    case 'circle':
      return `<svg class="shape-svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="${color}"/></svg>`;
    case 'triangle':
      return `<svg class="shape-svg" viewBox="0 0 100 100"><polygon points="50,10 90,85 10,85" fill="${color}"/></svg>`;
    case 'square':
      return `<svg class="shape-svg" viewBox="0 0 100 100"><rect x="15" y="15" width="70" height="70" rx="8" fill="${color}"/></svg>`;
    case 'rectangle':
      return `<svg class="shape-svg" viewBox="0 0 100 100"><rect x="10" y="25" width="80" height="50" rx="8" fill="${color}"/></svg>`;
    case 'oval':
      return `<svg class="shape-svg" viewBox="0 0 100 100"><ellipse cx="50" cy="50" rx="42" ry="26" fill="${color}"/></svg>`;
    default:
      return `<svg class="shape-svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="${color}"/></svg>`;
  }
}

// DOM Elements
const scoreDisplay = document.getElementById('score-display');
const roundDisplay = document.getElementById('round-display');
const soundBtn = document.getElementById('sound-btn');
const musicBtn = document.getElementById('music-btn');
const levelBtn = document.getElementById('level-btn');
const restartBtn = document.getElementById('restart-btn');
const questionText = document.getElementById('question-text');
const stage = document.getElementById('stage');
const triggerContainer = document.getElementById('trigger-container');
const startShuffleBtn = document.getElementById('start-shuffle-btn');

const levelModal = document.getElementById('level-modal');
const resultModal = document.getElementById('result-modal');
const resultCard = document.getElementById('result-card');
const resultTitle = document.getElementById('result-title');
const resultDetail = document.getElementById('result-detail');
const retryBtn = document.getElementById('retry-btn');
const nextBtn = document.getElementById('next-btn');

// Initialize Listeners
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  updateHUDDisplays();

  // Global event listeners to unlock audio on first touch/click
  ['click', 'touchstart', 'touchend', 'pointerdown'].forEach(eventType => {
    window.addEventListener(eventType, unlockAllAudio, { passive: true });
  });
});

function setupEventListeners() {
  soundBtn.addEventListener('click', () => {
    unlockAllAudio();
    soundEnabled = !soundEnabled;
    soundBtn.textContent = soundEnabled ? 'SOUND ON' : 'SOUND OFF';
    if (soundEnabled) playPopSound();
  });

  musicBtn.addEventListener('click', () => {
    unlockAllAudio();
    musicEnabled = !musicEnabled;
    musicBtn.textContent = musicEnabled ? 'MUSIC ON' : 'MUSIC OFF';
    if (musicEnabled) {
      startBGM();
    } else {
      stopBGM();
    }
  });

  levelBtn.addEventListener('click', () => {
    unlockAllAudio();
    playPopSound();
    levelModal.classList.add('active');
  });

  restartBtn.addEventListener('click', () => {
    unlockAllAudio();
    playPopSound();
    score = 0;
    currentRound = 1;
    updateHUDDisplays();
    startNewRound();
  });

  document.querySelectorAll('.level-card-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      unlockAllAudio();
      playPopSound();
      const card = e.currentTarget;
      currentLevel = parseInt(card.getAttribute('data-level'));
      currentRound = 1;
      levelModal.classList.remove('active');
      startNewRound();
    });
  });

  startShuffleBtn.addEventListener('click', () => {
    unlockAllAudio();
    playPopSound();
    triggerContainer.style.display = 'none';
    cupsData.forEach(item => item.cupEl.classList.remove('lifted'));
    setTimeout(() => {
      runShuffleAnimation();
    }, 500);
  });

  retryBtn.addEventListener('click', () => {
    unlockAllAudio();
    playPopSound();
    resultModal.classList.remove('active');
    retryCurrentRound();
  });

  nextBtn.addEventListener('click', () => {
    unlockAllAudio();
    playPopSound();
    resultModal.classList.remove('active');
    if (currentRound >= TOTAL_ROUNDS) {
      currentRound = 1;
      levelModal.classList.add('active');
    } else {
      currentRound++;
      updateHUDDisplays();
      startNewRound();
    }
  });
}

function updateHUDDisplays() {
  scoreDisplay.textContent = `SCORE: ${score}`;
  roundDisplay.textContent = `ROUND ${currentRound}/${TOTAL_ROUNDS}`;
}

// Start Brand New Game Round
function startNewRound() {
  roundPointsAwarded = false;
  updateHUDDisplays();
  const numCups = cupsCountForLevel[currentLevel];
  
  // Pick shapes for this round (including oval)
  const availableShapes = [...SHAPES];
  currentShapesSetup = [];
  for (let i = 0; i < numCups; i++) {
    const randomShape = availableShapes[i % availableShapes.length];
    currentShapesSetup.push(randomShape);
  }
  // Shuffle selected shapes
  currentShapesSetup.sort(() => Math.random() - 0.5);

  // Choose target shape
  targetShape = currentShapesSetup[Math.floor(Math.random() * currentShapesSetup.length)];
  
  renderRoundStage();
}

// Retry Current Round
function retryCurrentRound() {
  renderRoundStage();
}

// Render Round Stage in Initial Peek Mode
function renderRoundStage() {
  isShuffling = false;
  isGuessing = false;
  unduckBGM();
  stage.innerHTML = '';
  resultModal.classList.remove('active');
  retryBtn.style.display = 'none';
  nextBtn.style.display = 'none';
  triggerContainer.style.display = 'flex';

  const numCups = cupsCountForLevel[currentLevel];
  questionText.textContent = `Where is the ${targetShape.name}?`;

  // Calculate cup positions
  const cupWidth = 130;
  const gap = currentLevel === 3 ? 15 : (currentLevel === 2 ? 25 : 40);
  const totalWidth = numCups * cupWidth + (numCups - 1) * gap;
  const startX = -totalWidth / 2 + cupWidth / 2;

  cupsData = [];

  for (let i = 0; i < numCups; i++) {
    const posX = startX + i * (cupWidth + gap);
    
    const slotEl = document.createElement('div');
    slotEl.className = 'cup-slot';
    slotEl.style.transform = `translateX(${posX}px)`;

    const shapeHolder = document.createElement('div');
    shapeHolder.className = 'shape-holder';
    shapeHolder.innerHTML = getShapeSVG(currentShapesSetup[i].name);

    // Identical cups rendered in initial lifted state (PEEK MODE)
    const cupEl = document.createElement('div');
    cupEl.className = 'cup lifted disabled';
    cupEl.dataset.cupIndex = i;
    cupEl.innerHTML = `
      <div class="cup-body"></div>
      <div class="cup-lip"></div>
    `;

    slotEl.appendChild(shapeHolder);
    slotEl.appendChild(cupEl);
    stage.appendChild(slotEl);

    cupsData.push({
      id: i,
      shape: currentShapesSetup[i].name,
      slotEl: slotEl,
      cupEl: cupEl,
      posX: posX
    });

    cupEl.addEventListener('click', () => handleCupClick(i));
  }

  playLiftSound();
}

// Cup Shuffling Logic - Dynamic Speed & Sound Pops on each swap
function runShuffleAnimation() {
  isShuffling = true;
  duckBGM();

  const totalSwaps = currentLevel === 1 ? 4 : (currentLevel === 2 ? 6 : 8);
  const swapDuration = currentLevel === 1 ? 550 : (currentLevel === 2 ? 380 : 260);
  let swapCount = 0;

  function doSwap() {
    if (swapCount >= totalSwaps) {
      isShuffling = false;
      isGuessing = true;
      unduckBGM();
      // Reset swap classes & enable cup clicks
      cupsData.forEach(item => {
        item.slotEl.className = 'cup-slot';
        item.slotEl.style.transform = `translateX(${item.posX}px)`;
        item.cupEl.classList.remove('disabled');
      });
      return;
    }

    // Pick two distinct cups to swap
    const idx1 = Math.floor(Math.random() * cupsData.length);
    let idx2 = Math.floor(Math.random() * cupsData.length);
    while (idx1 === idx2) {
      idx2 = Math.floor(Math.random() * cupsData.length);
    }

    const cup1 = cupsData[idx1];
    const cup2 = cupsData[idx2];

    const pos1 = cup1.posX;
    const pos2 = cup2.posX;

    // Swap X position coordinates in data
    cup1.posX = pos2;
    cup2.posX = pos1;

    // 3D Arc Motion with elevation
    cup1.slotEl.className = 'cup-slot swapping-front';
    cup2.slotEl.className = 'cup-slot swapping-back';

    cup1.slotEl.style.transform = `translateX(${pos2}px) translateY(-25px) scale(1.12)`;
    cup2.slotEl.style.transform = `translateX(${pos1}px) translateY(12px) scale(0.92)`;

    playShuffleSound();
    swapCount++;

    setTimeout(() => {
      cup1.slotEl.style.transform = `translateX(${pos2}px) translateY(0px) scale(1)`;
      cup2.slotEl.style.transform = `translateX(${pos1}px) translateY(0px) scale(1)`;
    }, swapDuration * 0.7);

    setTimeout(doSwap, swapDuration);
  }

  doSwap();
}

// Handle Student Choice
function handleCupClick(clickedIdx) {
  if (!isGuessing || isShuffling) return;
  isGuessing = false;

  const clickedCup = cupsData[clickedIdx];
  clickedCup.cupEl.classList.add('lifted');
  playLiftSound();

  const isCorrect = (clickedCup.shape === targetShape.name);

  if (isCorrect) {
    playCorrectSound();
    const points = pointsForLevel[currentLevel];
    if (!roundPointsAwarded) {
      score += points;
      roundPointsAwarded = true;
    }
    updateHUDDisplays();

    // Show Correct Result Modal
    resultCard.className = 'modal-card result-card correct-style';
    resultTitle.textContent = '\u2713 CORRECT!';
    resultDetail.textContent = `+${points}`;
    retryBtn.style.display = 'inline-block';
    nextBtn.style.display = 'inline-block';
    
    setTimeout(() => {
      resultModal.classList.add('active');
    }, 400);

  } else {
    playWrongSound();
    // Reveal correct cup as well
    const correctCup = cupsData.find(item => item.shape === targetShape.name);
    if (correctCup && correctCup !== clickedCup) {
      setTimeout(() => {
        correctCup.cupEl.classList.add('lifted');
      }, 300);
    }

    // Determine 1-indexed left-to-right position of correct cup after shuffle
    const sortedByPos = [...cupsData].sort((a, b) => a.posX - b.posX);
    const correctCupPosition = sortedByPos.findIndex(item => item === correctCup) + 1;

    // Show Wrong Result Modal (Answer: Cup X)
    resultCard.className = 'modal-card result-card wrong-style';
    resultTitle.textContent = '\u2717 WRONG!';
    resultDetail.textContent = `Answer: Cup ${correctCupPosition}`;
    
    // Brief pop-up display before revealing RETRY & NEXT GAME buttons
    retryBtn.style.display = 'none';
    nextBtn.style.display = 'none';
    resultModal.classList.add('active');

    setTimeout(() => {
      retryBtn.style.display = 'inline-block';
      nextBtn.style.display = 'inline-block';
    }, 1200);
  }
}
