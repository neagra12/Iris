// ── ElevenLabs TTS — mobile-safe ──────────────────────────────────────────
// Key mobile rule: reuse ONE Audio element. Mobile browsers only unlock the
// specific element that received a user gesture — new Audio() objects created
// later in async contexts will be blocked.

const audioEl = new Audio();
audioEl.preload = 'auto';

let currentAbortController = null;
let unlocked = false;

// Must be called from a direct user tap (e.g. any button press).
// Plays a tiny silent clip on the shared element to unlock it for this session.
export function unlockSpeech() {
  if (unlocked) return;
  // Shortest valid silent MP3 (44 bytes)
  audioEl.src = 'data:audio/mpeg;base64,/+MYxAAAAANIAAAAAExBTUUzLjk4LjIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  audioEl.volume = 0;
  audioEl.play()
    .then(() => {
      audioEl.pause();
      audioEl.volume = 1;
      audioEl.src = '';
      unlocked = true; // only mark unlocked AFTER successful play
    })
    .catch(() => {
      // play blocked — don't mark unlocked, allow retry on next gesture
    });
}

export function stop() {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  audioEl.pause();
  audioEl.src = '';
}

export function isSpeaking() {
  return !audioEl.paused;
}

function humanize(text) {
  return text
    .replace(/(\d+)\s*mg\b/g, '$1 milligrams')
    .replace(/(\d+)\s*g\b/g, '$1 grams')
    .replace(/(\d+)\s*kcal\b/g, '$1 calories')
    .replace(/(\d+)\s*%/g, '$1 percent')
    .replace(/\s+—\s+/g, ', ')
    .replace(/\s+-\s+/g, ', ')
    .replace(/\bCKD\b/g, 'kidney disease')
    .replace(/\bHbA1c\b/gi, 'HbA 1 C')
    .replace(/\bLDL\b/g, 'L D L')
    .replace(/\bHDL\b/g, 'H D L')
    .replace(/[*_#`]/g, '')
    .trim();
}

function fallbackSpeak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.92;
  window.speechSynthesis.speak(u);
}

export async function speak(text) {
  if (!text) return;
  stop();

  const clean = humanize(text);
  const controller = new AbortController();
  currentAbortController = controller;

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean }),
      signal: controller.signal,
    });

    if (controller.signal.aborted) return;
    if (!res.ok) throw new Error(`TTS ${res.status}`);

    const { audio, mime } = await res.json();
    if (controller.signal.aborted) return;

    currentAbortController = null;

    // Convert base64 to Blob URL (more reliable than data URLs for autoplay)
    const bytes = Uint8Array.from(atob(audio), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);

    await new Promise((resolve, reject) => {
      const onReady = () => { audioEl.removeEventListener('error', onFail); resolve(); };
      const onFail  = () => { audioEl.removeEventListener('canplay', onReady); reject(new Error('audio load error')); };
      audioEl.addEventListener('canplay', onReady, { once: true });
      audioEl.addEventListener('error',   onFail,  { once: true });
      audioEl.src = url;
      audioEl.volume = 1;
      audioEl.load();
    });

    if (controller.signal.aborted) { URL.revokeObjectURL(url); return; }

    audioEl.play().catch(err => {
      console.warn('[speech] play() blocked:', err.message);
      unlocked = false;
      URL.revokeObjectURL(url);
      fallbackSpeak(clean);
    });

    audioEl.onended = () => URL.revokeObjectURL(url);
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.warn('[speech] ElevenLabs failed, fallback:', err.message);
    fallbackSpeak(clean);
  }
}

export function buildVerdictSpeech(analysis) {
  if (analysis.agent_reply) return analysis.agent_reply;
  const { product_name, verdict, reason, confidence_note } = analysis;
  const name = product_name || 'This product';
  if (confidence_note && analysis.confidence === 'low') {
    return `${confidence_note} My best guess is that ${name} is ${verdict}. ${reason}`;
  }
  const intro =
    verdict === 'Safe'    ? 'Great news —' :
    verdict === 'Caution' ? 'Just a heads up —' :
                            'Careful —';
  return `${intro} ${name} looks ${verdict}. ${reason}`;
}
