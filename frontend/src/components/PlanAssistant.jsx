import { useState, useEffect, useRef } from 'react';
import { speak, stop as stopSpeech, unlockSpeech } from '../utils/speech.js';

const FILLER = new Set([
  'um','uh','hmm','hm','ah','oh','okay','ok','yeah','yes','no',
  'hey','hi','hello','bye','thanks','thank','yep','nope','alright','right','sure',
]);

function isMeaningful(text, confidence) {
  if (confidence > 0 && confidence < 0.55) return false;
  const words = text.trim().toLowerCase().split(/\s+/);
  if (words.length < 4) return false;
  return words.filter(w => !FILLER.has(w)).length >= 2;
}

export default function PlanAssistant({ plan, healthProfile }) {
  const [isMuted, setIsMuted] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [lastExchange, setLastExchange] = useState(null);
  const [micError, setMicError] = useState('');

  const mutedRef = useRef(false);
  const processingRef = useRef(false);
  const recognitionRef = useRef(null);
  const handleSpeechRef = useRef(null);
  const contextRef = useRef({ plan, healthProfile });
  useEffect(() => { contextRef.current = { plan, healthProfile }; }, [plan, healthProfile]);

  // ── Auto-speak recommendations when plan first loads ──────────────────
  useEffect(() => {
    const recs = plan?.nutritional_recommendations;
    if (!recs?.length) return;
    stopSpeech();
    // Short pause then speak all recs joined naturally
    const timeout = setTimeout(() => {
      speak(`Here are my recommendations for this week. ${recs.join(' ')}`);
    }, 600);
    return () => clearTimeout(timeout);
  }, [plan]);

  // ── Core handler ──────────────────────────────────────────────────────
  async function handleSpeech(text) {
    stopSpeech();
    processingRef.current = true;
    setIsProcessing(true);
    setLastExchange({ question: text, reply: '...' });

    const { plan: p, healthProfile: hp } = contextRef.current;
    try {
      const res = await fetch('/api/chat-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, plan: p, healthProfile: hp }),
      });
      const data = await res.json();
      if (data.reply) {
        setLastExchange({ question: text, reply: data.reply });
        speak(data.reply);
      }
    } catch (err) {
      console.error('Plan chat error:', err);
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  }

  handleSpeechRef.current = handleSpeech;

  // ── Boot recognition ──────────────────────────────────────────────────
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { setMicError('Use Chrome for voice.'); return; }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => { setIsListening(true); setMicError(''); };

    recognition.onresult = (event) => {
      if (mutedRef.current) return;
      let interim = '', final = '', confidence = 1;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) { final += r[0].transcript; confidence = r[0].confidence ?? 1; }
        else interim += r[0].transcript;
      }
      if (interim) setInterimText(interim);
      if (final.trim()) {
        setInterimText('');
        if (isMeaningful(final.trim(), confidence) && !processingRef.current) {
          handleSpeechRef.current(final.trim());
        }
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimText('');
      if (!mutedRef.current) setTimeout(() => { try { recognition.start(); } catch {} }, 300);
    };

    recognition.onerror = (e) => {
      setIsListening(false);
      if (e.error === 'not-allowed') { setMicError('Mic access denied. Please allow and reload.'); return; }
      if (e.error === 'no-speech') return;
      if (!mutedRef.current) setTimeout(() => { try { recognition.start(); } catch {} }, 800);
    };

    recognitionRef.current = recognition;
    navigator.mediaDevices?.getUserMedia({ audio: true })
      .then(() => { try { recognition.start(); } catch {} })
      .catch(() => setMicError('Mic access denied. Please allow and reload.'));

    return () => { mutedRef.current = true; try { recognition.stop(); } catch {} };
  }, []);

  function toggleMute() {
    unlockSpeech(); // user gesture — unlocks TTS on mobile
    const muting = !mutedRef.current;
    mutedRef.current = muting;
    setIsMuted(muting);
    if (muting) { stopSpeech(); try { recognitionRef.current?.stop(); } catch {} }
    else { try { recognitionRef.current?.start(); } catch {} }
  }

  if (!('SpeechRecognition' in window) && !('webkitSpeechRecognition' in window)) return null;

  if (micError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-3 text-sm text-red-600 flex items-center gap-2">
        <span>🎤</span> {micError}
      </div>
    );
  }

  const statusLabel = isMuted ? 'Muted'
    : isProcessing ? 'Thinking...'
    : interimText ? interimText
    : isListening ? 'Listening...'
    : 'Starting...';

  const statusColor = isMuted ? 'text-gray-400'
    : isProcessing ? 'text-blue-500'
    : isListening ? 'text-green-600'
    : 'text-gray-400';

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 p-3">
        <button
          onClick={toggleMute}
          className={`w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center shadow transition-all
            ${isMuted ? 'bg-gray-200' : isProcessing ? 'bg-blue-600' : 'bg-green-600'} text-white`}
        >
          {isProcessing ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : isMuted ? (
            <span className="text-xl">🔇</span>
          ) : (
            <div className="flex items-end gap-0.5 h-5">
              {[3, 5, 4, 6, 3].map((h, i) => (
                <div key={i}
                  className={`w-1 rounded-full bg-white ${isListening ? 'animate-bounce' : 'opacity-50'}`}
                  style={{ height: `${h * 3}px`, animationDelay: `${i * 80}ms`, animationDuration: '600ms' }}
                />
              ))}
            </div>
          )}
        </button>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold truncate ${statusColor}`}>{statusLabel}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {isMuted ? 'Tap to unmute' : 'Ask about your plan — nutrients, swaps, meal ideas'}
          </p>
        </div>
      </div>

      {lastExchange && (
        <div className="border-t border-gray-50 px-3 py-2 space-y-1">
          <p className="text-xs text-gray-400 italic truncate">You: &ldquo;{lastExchange.question}&rdquo;</p>
          <p className="text-xs text-blue-700 font-medium leading-snug">{lastExchange.reply}</p>
        </div>
      )}
    </div>
  );
}
