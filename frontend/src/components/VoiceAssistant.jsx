import { useState, useEffect, useRef } from 'react';
import { speak, stop as stopSpeech, unlockSpeech } from '../utils/speech.js';

// Scan trigger: any phrase containing an action word + a pointer word, OR just "scan"
const SCAN_ACTION = ['buy', 'get', 'eat', 'have', 'take', 'pick', 'grab', 'scan', 'check', 'analyze', 'analyse'];
const SCAN_POINTER = ['this', 'it', 'that', 'these', 'here'];

const COMPARE_TRIGGERS = [
  'which is better', 'which one is better', 'which is healthier', 'which one is healthier',
  'which should i buy', 'which should i get', 'which should i choose', 'which should i pick',
  'compare these', 'compare them', 'compare the two', 'compare both',
  'what\'s the difference', 'whats the difference', 'what is the difference',
  'which is worse', 'which one should i avoid',
  'better option', 'better choice', 'which is best',
  'which one', 'which do you recommend',
];

const CART_TRIGGERS = [
  'add to cart', 'add this to cart', 'add it to cart', 'add this',
  'put in cart', 'put it in cart', 'put this in cart',
  'add it', 'cart this', 'yes add', 'yeah add', 'okay add',
  'ok add', 'add that', 'add this one', 'i want this',
  'i\'ll take it', 'i\'ll take this', 'ill take it', 'ill take this',
];

// Words that are never meaningful on their own
const FILLER = new Set([
  'um', 'uh', 'hmm', 'hm', 'ah', 'oh', 'okay', 'ok', 'yeah', 'yes', 'no',
  'hey', 'hi', 'hello', 'bye', 'thanks', 'thank', 'yep', 'nope', 'alright',
  'right', 'sure', 'cool', 'great', 'nice', 'good', 'fine',
]);

function isScanTrigger(text) {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);
  const hasAction = SCAN_ACTION.some(a => words.includes(a));
  const hasPointer = SCAN_POINTER.some(p => words.includes(p));
  // "scan" alone is enough; otherwise need action + pointer
  if (words.includes('scan') || words.includes('analyze') || words.includes('analyse')) return true;
  return hasAction && hasPointer;
}

function isCompareTrigger(text) {
  const lower = text.toLowerCase();
  return COMPARE_TRIGGERS.some(t => lower.includes(t));
}

function isCartTrigger(text) {
  const lower = text.toLowerCase();
  return CART_TRIGGERS.some(t => lower.includes(t));
}

// Returns true only if the speech is worth acting on
function isMeaningful(text, confidence) {
  const words = text.trim().toLowerCase().split(/\s+/).filter(w => w.length > 0);

  // Scan/compare/cart triggers: always pass — never filter by confidence or word count
  if (isScanTrigger(text) && words.length >= 2) return true;
  if (isCompareTrigger(text) && words.length >= 2) return true;
  if (isCartTrigger(text) && words.length >= 2) return true;

  // Conversational: apply confidence filter (mobile often returns lower scores)
  if (confidence > 0 && confidence < 0.45) return false;

  // Needs 4+ words and at least 2 non-filler words
  const meaningful = words.filter(w => !FILLER.has(w));
  if (words.length < 4) return false;
  if (meaningful.length < 2) return false;

  return true;
}

export default function VoiceAssistant({ analysis, healthProfile, onScanTrigger, onCompareTrigger, onCartTrigger, onExchange, onInterim, compact }) {
  const [isMuted, setIsMuted] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [lastExchange, setLastExchange] = useState(null);
  const [micError, setMicError] = useState('');

  const mutedRef = useRef(false);
  const processingRef = useRef(false);
  const recognitionRef = useRef(null);

  // ── Always-fresh refs so the recognition callback never uses stale values
  const contextRef = useRef({ analysis, healthProfile });
  const onScanTriggerRef = useRef(onScanTrigger);
  const onCompareTriggerRef = useRef(onCompareTrigger);
  const onCartTriggerRef = useRef(onCartTrigger);
  const onExchangeRef = useRef(onExchange);
  const handleSpeechRef = useRef(null);

  useEffect(() => { contextRef.current = { analysis, healthProfile }; }, [analysis, healthProfile]);
  useEffect(() => { onScanTriggerRef.current = onScanTrigger; }, [onScanTrigger]);
  useEffect(() => { onCompareTriggerRef.current = onCompareTrigger; }, [onCompareTrigger]);
  useEffect(() => { onCartTriggerRef.current = onCartTrigger; }, [onCartTrigger]);
  useEffect(() => { onExchangeRef.current = onExchange; }, [onExchange]);
  const onInterimRef = useRef(onInterim);
  useEffect(() => { onInterimRef.current = onInterim; }, [onInterim]);

  function updateExchange(exchange) {
    setLastExchange(exchange);
    onExchangeRef.current?.(exchange);
  }

  // ── Core speech handler (kept fresh via ref) ───────────────────────────
  async function handleSpeech(text) {
    stopSpeech(); // meaningful speech always interrupts the current response

    if (isScanTrigger(text)) {
      updateExchange({ question: text, reply: 'Scanning now...' });
      onScanTriggerRef.current?.();
      return;
    }

    if (isCompareTrigger(text)) {
      updateExchange({ question: text, reply: 'Comparing products...' });
      onCompareTriggerRef.current?.(text);
      return;
    }

    if (isCartTrigger(text)) {
      const added = onCartTriggerRef.current?.();
      const reply = added === false ? 'Nothing to add — scan a product first.' : 'Added to cart!';
      updateExchange({ question: text, reply });
      speak(reply);
      return;
    }

    processingRef.current = true;
    setIsProcessing(true);
    updateExchange({ question: text, reply: '...' });

    const { analysis: a, healthProfile: hp } = contextRef.current;
    try {
      const res = await fetch('/api/voice-ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, healthProfile: hp }),
      });
      const data = await res.json();
      if (res.status === 429) {
        const msg = "I'm a bit busy right now — ask me again in a moment.";
        updateExchange({ question: text, reply: msg });
        speak(msg);
      } else if (data.reply) {
        updateExchange({ question: text, reply: data.reply });
        speak(data.reply);
      }
    } catch (err) {
      console.error('Chat error:', err);
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  }

  // Keep the ref fresh on every render so recognition.onresult always calls
  // the latest version (avoids ALL stale closure issues in one place)
  handleSpeechRef.current = handleSpeech;

  // ── Boot recognition ONCE ──────────────────────────────────────────────
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMicError('Speech recognition not supported in this browser. Use Chrome.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
      setMicError('');
    };

    recognition.onresult = (event) => {
      if (mutedRef.current) return;
      let interim = '';
      let finalText = '';
      let finalConfidence = 1;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
          finalConfidence = result[0].confidence ?? 1;
        } else {
          interim += result[0].transcript;
        }
      }

      // Show interim text so the user sees their words live
      if (interim) { setInterimText(interim); onInterimRef.current?.(interim); }

      if (finalText.trim()) {
        const text = finalText.trim();
        // Show last heard text so user can debug
        setInterimText(`Heard: "${text}"`);
        onInterimRef.current?.(`Heard: "${text}"`);
        setTimeout(() => { setInterimText(''); onInterimRef.current?.(''); }, 2500);

        // Scan & compare triggers always fire — bypass all filters
        if (isScanTrigger(text)) {
          processingRef.current = false;
          setIsProcessing(false);
          handleSpeechRef.current(text);
          return;
        }

        if (isCompareTrigger(text)) {
          processingRef.current = false;
          setIsProcessing(false);
          handleSpeechRef.current(text);
          return;
        }

        // Conversational: apply filters
        if (!isMeaningful(text, finalConfidence)) return;
        if (!processingRef.current) {
          handleSpeechRef.current(text);
        }
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimText('');
      if (!mutedRef.current) {
        setTimeout(() => { try { recognition.start(); } catch {} }, 300);
      }
    };

    recognition.onerror = (e) => {
      setIsListening(false);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setMicError('Microphone access denied. Please allow mic access and reload.');
        return;
      }
      if (e.error === 'no-speech') return; // normal, just keep going
      if (!mutedRef.current) {
        setTimeout(() => { try { recognition.start(); } catch {} }, 800);
      }
    };

    recognitionRef.current = recognition;

    // Start recognition immediately — onerror handles 'not-allowed' if mic is denied.
    // Don't gate on getUserMedia since camera may already be using the device.
    try { recognition.start(); } catch {}

    return () => {
      mutedRef.current = true;
      try { recognition.stop(); } catch {}
    };
  }, []);

  // ── Mute toggle ────────────────────────────────────────────────────────
  function toggleMute() {
    unlockSpeech(); // user gesture — unlocks TTS on mobile
    const muting = !mutedRef.current;
    mutedRef.current = muting;
    setIsMuted(muting);
    if (muting) {
      stopSpeech();
      try { recognitionRef.current?.stop(); } catch {}
    } else {
      try { recognitionRef.current?.start(); } catch {}
    }
  }

  // In compact mode, errors show as a disabled button — never break the camera layout
  if (compact) {
    const noSupport = !('SpeechRecognition' in window) && !('webkitSpeechRecognition' in window);
    if (noSupport || micError) {
      return (
        <button
          disabled
          className="w-16 h-16 rounded-full flex items-center justify-center bg-red-500/40 border-2 border-red-400/40"
          title={micError || 'Chrome required'}
        >
          <span className="text-2xl">🎤</span>
        </button>
      );
    }
  }

  if (!('SpeechRecognition' in window) && !('webkitSpeechRecognition' in window)) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-600">
        Voice agent requires Chrome. Please open this app in Chrome.
      </div>
    );
  }

  if (micError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-600 flex items-start gap-2">
        <span className="text-lg">🎤</span>
        <div>
          <p className="font-semibold">Mic issue</p>
          <p>{micError}</p>
        </div>
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

  if (compact) {
    return (
      <button
        onClick={toggleMute}
        style={{
          width: 56, height: 56, borderRadius: '50%',
          background: isProcessing ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)',
          border: isListening ? '2px solid rgba(255,255,255,0.50)'
            : isProcessing ? '2px solid rgba(255,255,255,0.40)'
            : '2px solid rgba(255,255,255,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
          color: isListening ? '#fff' : 'rgba(255,255,255,0.75)',
        }}
      >
        {isProcessing ? (
          <div style={{ width: 22, height: 22, borderRadius: '50%', border: '2.5px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', animation: 'spin 0.8s linear infinite' }} />
        ) : isMuted ? (
          /* Mic-off SVG */
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
            <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        ) : (
          /* Mic SVG */
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        )}
      </button>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 p-3">
        <button
          onClick={toggleMute}
          className={`w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center transition-all shadow
            ${isMuted ? 'bg-gray-200 text-gray-400'
              : isProcessing ? 'bg-blue-600 text-white'
              : 'bg-green-600 text-white'}`}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isProcessing ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : isMuted ? (
            <span className="text-xl">🔇</span>
          ) : (
            <div className="flex items-end gap-0.5 h-5">
              {[3, 5, 4, 6, 3].map((h, i) => (
                <div
                  key={i}
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
            {isMuted
              ? 'Tap to unmute'
              : 'Say "Should I buy this?" to scan, or ask anything'}
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
