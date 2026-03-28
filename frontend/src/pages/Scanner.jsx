import { useState, useRef, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { scanProduct } from '../utils/api.js';
import { speak, stop as stopSpeech, buildVerdictSpeech, unlockSpeech } from '../utils/speech.js';
import VoiceAssistant from '../components/VoiceAssistant.jsx';

function AltCard({ name, reason, index }) {
  const [imageUrl, setImageUrl] = useState(null);
  const [imgLoading, setImgLoading] = useState(true);

  useEffect(() => {
    if (name === 'Alternative Product') { setImgLoading(false); return; }
    const controller = new AbortController();
    const run = async () => {
      await new Promise(r => setTimeout(r, index * 200));
      if (controller.signal.aborted) return;
      try {
        const res = await fetch(`/api/image-search?q=${encodeURIComponent(name)}`, { signal: controller.signal });
        const data = await res.json();
        if (data.imageUrl) setImageUrl(data.imageUrl);
      } catch {}
      finally { setImgLoading(false); }
    };
    run();
    return () => controller.abort();
  }, [name, index]);

  return (
    <div className="flex items-center gap-3 bg-white/10 rounded-xl overflow-hidden border border-white/10">
      <div className="w-16 h-16 flex-shrink-0 bg-white/5 flex items-center justify-center p-1.5">
        {imgLoading ? (
          <div className="w-5 h-5 rounded-full border-2 border-white/20 border-t-green-400 animate-spin" />
        ) : imageUrl ? (
          <img src={imageUrl} alt={name} className="w-full h-full object-contain" onError={() => setImageUrl(null)} />
        ) : (
          <span className="text-2xl opacity-50">🛒</span>
        )}
      </div>
      <div className="flex-1 pr-3 py-2">
        <p className="text-white text-xs font-bold leading-tight">{name}</p>
        {reason && <p className="text-green-300 text-xs mt-0.5 leading-snug">{reason}</p>}
      </div>
    </div>
  );
}

export default function Scanner() {
  const { healthProfile, addToCart, cart } = useApp();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [facingMode, setFacingMode] = useState('environment');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [addedToCart, setAddedToCart] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [exchange, setExchange] = useState(null);
  const [interim, setInterim] = useState('');

  const scanningRef = useRef(false);
  const facingModeRef = useRef(facingMode);
  const healthProfileRef = useRef(healthProfile);
  const retryCountRef = useRef(0);
  useEffect(() => { healthProfileRef.current = healthProfile; }, [healthProfile]);

  // ── Camera ────────────────────────────────────────────────────────────────
  const startCamera = useCallback(async (facing) => {
    const mode = facing ?? facingModeRef.current;
    setCameraError('');
    setCameraReady(false);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Use onloadedmetadata so we don't depend on play() promise timing
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch(() => {});
          setCameraReady(true);
          retryCountRef.current = 0;
        };
      }
    } catch (err) {
      // Auto-retry once silently (covers timing issues on first mount)
      if (retryCountRef.current === 0) {
        retryCountRef.current = 1;
        setTimeout(() => startCamera(mode), 800);
      } else {
        setCameraError(`Camera unavailable. ${err.message}`);
      }
    }
  }, []);

  useEffect(() => {
    // Small delay to ensure video element is fully mounted before requesting camera
    const timer = setTimeout(() => startCamera(), 150);
    return () => {
      clearTimeout(timer);
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      stopSpeech();
    };
  }, [startCamera]);

  function flipCamera() {
    const next = facingModeRef.current === 'environment' ? 'user' : 'environment';
    facingModeRef.current = next;
    setFacingMode(next);
    retryCountRef.current = 0;
    startCamera(next);
  }

  // ── Frame capture ─────────────────────────────────────────────────────────
  function captureFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    if (!video.videoWidth) {
      canvas.width = 640; canvas.height = 480;
      try {
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, 640, 480);
        const data = canvas.toDataURL('image/jpeg', 0.85).replace(/^data:image\/jpeg;base64,/, '');
        if (data.length > 100) return data;
      } catch {}
      return null;
    }
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.85).replace(/^data:image\/jpeg;base64,/, '');
  }

  function buildFullSpeech(result) {
    let speech = buildVerdictSpeech(result);
    const alts = result.alternatives?.filter(a => a.name || a.product_name || a.swap_in);
    if ((result.verdict === 'Caution' || result.verdict === 'Avoid') && alts?.length > 0) {
      const names = alts.slice(0, 3).map(a => a.name || a.product_name || a.swap_in).join(', ');
      speech += ` Instead, you could try ${names}.`;
    }
    return speech;
  }

  // ── Scan trigger ──────────────────────────────────────────────────────────
  const handleScanTrigger = useCallback(async () => {
    if (scanningRef.current) return;
    const base64 = captureFrame();
    if (!base64) { speak('Camera not ready yet, try again in a moment.'); return; }

    scanningRef.current = true;
    setScanning(true);
    stopSpeech();

    try {
      const res = await fetch('/api/voice-ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Should I buy this? Is it safe for my health?',
          image: base64, mimeType: 'image/jpeg',
          healthProfile: healthProfileRef.current,
        }),
      });
      const data = await res.json();
      if (data.reply) {
        setExchange({ question: 'Should I buy this?', reply: data.reply });
        speak(data.reply);
      }
      scanProduct(base64, healthProfileRef.current, 'image/jpeg')
        .then(({ analysis: result }) => { setAnalysis(result); setAddedToCart(false); })
        .catch(() => {});
    } catch {
      speak('Sorry, I had trouble scanning that. Try again.');
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, []);

  // ── Compare ───────────────────────────────────────────────────────────────
  const handleCompareTrigger = useCallback(async (question) => {
    if (scanningRef.current) return;
    const base64 = captureFrame();
    if (!base64) { speak('Camera not ready, try again.'); return; }
    scanningRef.current = true;
    setScanning(true);
    stopSpeech();
    try {
      const res = await fetch('/api/compare-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mimeType: 'image/jpeg', question, healthProfile: healthProfileRef.current }),
      });
      const data = await res.json();
      if (data.reply) { setExchange({ question, reply: data.reply }); speak(data.reply); }
    } catch {
      speak('Sorry, I had trouble comparing those. Try again.');
    } finally {
      scanningRef.current = false;
      setScanning(false);
    }
  }, []);

  // ── Manual entry ──────────────────────────────────────────────────────────
  async function handleManualScan() {
    if (!manualInput.trim() || scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);
    stopSpeech();
    setShowManual(false);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    canvas.width = 400; canvas.height = 200;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 400, 200);
    ctx.fillStyle = '#000'; ctx.font = '24px Arial'; ctx.textAlign = 'center';
    ctx.fillText(manualInput, 200, 100);
    const base64 = canvas.toDataURL('image/jpeg').replace(/^data:image\/jpeg;base64,/, '');
    try {
      const { analysis: result } = await scanProduct(base64, healthProfileRef.current, 'image/jpeg');
      setAnalysis(result); setAddedToCart(false);
      speak(buildFullSpeech(result));
    } catch {
      setAnalysis({ product_name: manualInput, verdict: 'Caution', reason: `Could not analyze "${manualInput}".`, confidence: 'low', nutrients: {}, alternatives: [] });
    } finally {
      scanningRef.current = false; setScanning(false); setManualInput('');
    }
  }

  // ── Cart ──────────────────────────────────────────────────────────────────
  function handleAddToCart() {
    if (!analysis || addedToCart) return false;
    addToCart({ product_name: analysis.product_name, verdict: analysis.verdict, nutrients: analysis.nutrients, reason: analysis.reason });
    setAddedToCart(true);
    setToastMsg(`Added "${analysis.product_name}" to cart!`);
    setTimeout(() => setToastMsg(''), 2500);
  }

  const verdictBg = analysis?.verdict === 'Safe'
    ? 'border-green-400/40 bg-green-900/20'
    : analysis?.verdict === 'Caution'
    ? 'border-yellow-400/40 bg-yellow-900/20'
    : 'border-red-400/40 bg-red-900/20';

  const verdictBadge = analysis?.verdict === 'Safe'
    ? 'bg-green-500/30 text-green-300 border-green-400/40'
    : analysis?.verdict === 'Caution'
    ? 'bg-yellow-500/30 text-yellow-300 border-yellow-400/40'
    : 'bg-red-500/30 text-red-300 border-red-400/40';

  // NavBar is ~64px tall (fixed bottom-0). Bottom bar sits above it.
  const NAV_H = 64;
  const BAR_H = 88; // bottom control bar height
  const RESULTS_BOTTOM = NAV_H + BAR_H; // results panel sits above both

  return (
    <div className="fixed inset-0 bg-black overflow-hidden" onClick={unlockSpeech}>
      {/* Full-screen camera */}
      <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
      <canvas ref={canvasRef} className="hidden" />

      {/* Toast */}
      {toastMsg && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-green-600/90 backdrop-blur-md text-white px-5 py-2 rounded-full shadow-lg text-sm font-semibold whitespace-nowrap">
          ✓ {toastMsg}
        </div>
      )}

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-5 pt-10 pb-4">
        <div className="flex items-center gap-2 bg-black/30 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-white text-xs font-semibold tracking-widest uppercase">Live</span>
        </div>
        {cart.length > 0 && (
          <div className="bg-green-500/80 backdrop-blur-md text-white text-xs font-bold rounded-full w-8 h-8 flex items-center justify-center border border-green-400/40 shadow">
            {cart.length}
          </div>
        )}
      </div>

      {/* Scanning indicator */}
      {scanning && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <div className="bg-black/60 backdrop-blur-sm px-6 py-3 rounded-full flex items-center gap-3 border border-white/10">
            <div className="w-4 h-4 border-2 border-white/20 border-t-green-400 rounded-full animate-spin" />
            <span className="text-white font-bold tracking-widest text-sm uppercase">Scanning</span>
          </div>
        </div>
      )}

      {/* Camera error — only shown after auto-retry fails */}
      {cameraError && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/80 pointer-events-auto">
          <div className="text-center text-white px-8">
            <div className="text-5xl mb-3">📷</div>
            <p className="text-sm text-white/70 mb-4">{cameraError}</p>
            <button
              onClick={() => { retryCountRef.current = 0; startCamera(); }}
              className="bg-white/20 border border-white/30 text-white text-sm px-5 py-2 rounded-full"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Live interim speech */}
      {interim && (
        <div className="absolute top-1/2 left-4 right-4 -translate-y-1/2 z-20 flex justify-center pointer-events-none">
          <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/15">
            <p className="text-white/80 text-sm italic">{interim}</p>
          </div>
        </div>
      )}

      {/* Scrollable results — above bottom bar + NavBar */}
      {(exchange || analysis) && (
      <div
        className="absolute left-0 right-0 z-20 overflow-y-auto"
        style={{ bottom: RESULTS_BOTTOM, maxHeight: '55vh' }}
      >
        <div className="px-4 pt-3 pb-2 space-y-3">

          {/* Dismiss button */}
          <div className="flex justify-end">
            <button
              onClick={() => { setExchange(null); setAnalysis(null); setAddedToCart(false); stopSpeech(); }}
              style={{
                width: 28, height: 28, borderRadius: '50%',
                background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.2)',
                color: 'rgba(255,255,255,0.7)', fontSize: 16, lineHeight: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
              }}
              title="Dismiss"
            >×</button>
          </div>

          {exchange && (
            <div className="bg-black/30 backdrop-blur-md rounded-2xl px-4 py-3 border border-white/10 space-y-1.5">
              <p className="text-white/50 text-xs italic truncate">You: &ldquo;{exchange.question}&rdquo;</p>
              <p className="text-white text-sm font-medium leading-snug">{exchange.reply}</p>
            </div>
          )}

          {analysis && (
            <div className={`backdrop-blur-md rounded-2xl px-4 py-3 border ${verdictBg}`}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${verdictBadge}`}>
                  {analysis.verdict}
                </span>
                <span className="text-white font-semibold text-sm flex-1 truncate">{analysis.product_name}</span>
              </div>
              <p className="text-white/65 text-xs leading-snug line-clamp-2">{analysis.reason}</p>
              <div className="mt-2">
                {!addedToCart ? (
                  <button onClick={handleAddToCart} className="text-xs bg-white/15 hover:bg-white/25 text-white px-3 py-1.5 rounded-full border border-white/20 transition-all active:scale-95">
                    + Add to cart
                  </button>
                ) : (
                  <span className="text-xs text-green-400 font-semibold">✓ Added to cart</span>
                )}
              </div>
            </div>
          )}

          {analysis && (analysis.verdict === 'Caution' || analysis.verdict === 'Avoid') && analysis.alternatives?.length > 0 && (
            <div className="bg-black/20 backdrop-blur-md rounded-2xl px-4 py-3 border border-white/10">
              <p className="text-white/80 text-xs font-bold mb-3 flex items-center gap-1.5">
                <span>💡</span> Better Alternatives
              </p>
              <div className="space-y-2">
                {analysis.alternatives.map((alt, i) => {
                  const name = alt.name || alt.product_name || alt.swap_in || alt.title ||
                    alt.product || alt.suggestion || alt.alternative || alt.item ||
                    Object.values(alt).find(v => typeof v === 'string' && v.length > 3 && v.length < 100) ||
                    'Alternative Product';
                  const reason = alt.reason || alt.why || alt.description || alt.benefit || '';
                  return <AltCard key={i} name={name} reason={reason} index={i} />;
                })}
              </div>
            </div>
          )}

        </div>
      </div>
      )}

      {/* Idle hint when no results */}
      {!exchange && !analysis && cameraReady && (
        <div className="absolute left-0 right-0 z-10 flex justify-center pointer-events-none"
          style={{ bottom: RESULTS_BOTTOM + 8 }}>
          <p className="text-white/40 text-xs">
            Tap 📷 to scan or say &ldquo;Should I buy this?&rdquo;
          </p>
        </div>
      )}

      {/* Manual input */}
      {showManual && (
        <div
          className="absolute left-4 right-4 z-30 bg-black/70 backdrop-blur-xl rounded-2xl p-4 border border-white/15"
          style={{ bottom: RESULTS_BOTTOM + 8 }}
        >
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Type product name..."
              className="flex-1 bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-white text-sm placeholder-white/40 outline-none focus:border-white/40"
              value={manualInput}
              onChange={e => setManualInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleManualScan()}
              autoFocus
            />
            <button
              onClick={handleManualScan}
              disabled={scanning || !manualInput.trim()}
              className="bg-green-500 disabled:opacity-40 text-white px-4 rounded-xl text-sm font-semibold active:scale-95 transition-all"
            >
              Go
            </button>
          </div>
        </div>
      )}

      {/* ── 4-button bottom bar — sits directly above the NavBar ── */}
      <div
        className="absolute left-0 right-0 z-20 bg-black/60 backdrop-blur-xl border-t border-white/10"
        style={{ bottom: NAV_H, height: BAR_H }}
      >
        <div className="h-full flex items-center justify-around px-8 max-w-sm mx-auto">

          {/* 1. Flip camera */}
          <button onClick={() => { unlockSpeech(); flipCamera(); }} style={btnStyle} title="Flip camera">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 4v6h6" />
              <path d="M3.51 15a9 9 0 1 0 .49-4.5L1 10" />
            </svg>
            <span style={btnLabel}>Flip</span>
          </button>

          {/* 2. Scan */}
          <button
            onClick={() => { unlockSpeech(); handleScanTrigger(); }}
            disabled={scanning}
            style={{ ...btnStyle, border: '2px solid rgba(255,255,255,0.30)' }}
            title="Scan product"
          >
            {scanning ? (
              <div style={{ width: 22, height: 22, borderRadius: '50%', border: '2.5px solid rgba(255,255,255,0.15)', borderTopColor: '#fff', animation: 'spin 0.8s linear infinite' }} />
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            )}
            <span style={btnLabel}>{scanning ? '…' : 'Scan'}</span>
          </button>

          {/* 3. Type / manual */}
          <button
            onClick={() => { unlockSpeech(); setShowManual(v => !v); }}
            style={{
              ...btnStyle,
              background: showManual ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)',
              border: showManual ? '2px solid rgba(255,255,255,0.40)' : '2px solid rgba(255,255,255,0.15)',
            }}
            title="Type product name"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 7 4 4 20 4 20 7" />
              <line x1="9" y1="20" x2="15" y2="20" />
              <line x1="12" y1="4" x2="12" y2="20" />
            </svg>
            <span style={btnLabel}>Type</span>
          </button>

          {/* 4. Voice */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <VoiceAssistant
              compact
              analysis={analysis}
              healthProfile={healthProfile}
              onScanTrigger={handleScanTrigger}
              onCompareTrigger={handleCompareTrigger}
              onCartTrigger={handleAddToCart}
              onExchange={setExchange}
              onInterim={setInterim}
            />
            <span style={btnLabel}>Voice</span>
          </div>

        </div>
      </div>
    </div>
  );
}

const btnStyle = {
  width: 56, height: 56, borderRadius: '50%',
  background: 'rgba(255,255,255,0.08)',
  border: '2px solid rgba(255,255,255,0.15)',
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  gap: 3, cursor: 'pointer', transition: 'all 0.15s',
  color: '#fff',
};

const btnLabel = {
  fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.55)',
  textTransform: 'uppercase', letterSpacing: '0.6px',
};
