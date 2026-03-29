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

const ELEVENLABS_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'; // Sarah
const ELEVENLABS_API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY;

export async function speak(text) {
  if (!text) return;
  stop();

  const clean = humanize(text);
  const controller = new AbortController();
  currentAbortController = controller;

  try {
    if (!ELEVENLABS_API_KEY) throw new Error('No ElevenLabs key — using fallback');

    // Call ElevenLabs directly from the browser so the request comes from
    // the user's real IP, not a datacenter (Render/Railway block free tier).
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: clean,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.45, similarity_boost: 0.80, style: 0.2 },
        }),
        signal: controller.signal,
      }
    );

    if (controller.signal.aborted) return;
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`ElevenLabs ${res.status}: ${errBody}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    if (controller.signal.aborted) return;

    currentAbortController = null;

    const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
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
