import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';

const VERDICT_CONFIG = {
  Safe: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-700',
    badge: 'bg-green-100 text-green-800 border-green-300',
    icon: '✅',
    ring: 'ring-green-200',
  },
  Caution: {
    bg: 'bg-yellow-50',
    border: 'border-yellow-200',
    text: 'text-yellow-700',
    badge: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    icon: '⚠️',
    ring: 'ring-yellow-200',
  },
  Avoid: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
    badge: 'bg-red-100 text-red-800 border-red-300',
    icon: '🚫',
    ring: 'ring-red-200',
  },
};

export default function VerdictCard({ analysis, onAddToCart }) {
  const [imageUrl, setImageUrl] = useState(null);
  const [imgLoading, setImgLoading] = useState(false);

  useEffect(() => {
    if (!analysis?.product_name || analysis.product_name === 'Unknown Product') {
      setImageUrl(null);
      return;
    }

    const controller = new AbortController();
    const fetchImage = async () => {
      setImgLoading(true);
      try {
        const res = await fetch(`/api/image-search?q=${encodeURIComponent(analysis.product_name)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (data.imageUrl) setImageUrl(data.imageUrl);
      } catch (err) {
        if (err.name !== 'AbortError') console.error('Main image fetch failed');
      } finally {
        setImgLoading(false);
      }
    };

    fetchImage();
    return () => controller.abort();
  }, [analysis?.product_name]);

  if (!analysis) return null;

  const {
    product_name,
    verdict,
    reason,
    confidence,
    confidence_note,
    nutrients,
    serving_size,
  } = analysis;

  const cfg = VERDICT_CONFIG[verdict] || VERDICT_CONFIG.Safe;

  return (
    <div className={`slide-up rounded-2xl border-2 ${cfg.border} ${cfg.bg} p-5 space-y-4 shadow-sm relative overflow-hidden`}>
      {/* Product Banner Image */}
      {imageUrl && (
        <div className="h-40 -mt-5 -mx-5 mb-4 bg-white/50 relative">
          <img
            src={imageUrl}
            alt={product_name}
            className="w-full h-full object-contain p-4 mix-blend-multiply"
            onError={() => setImageUrl(null)}
          />
          <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/5 to-transparent pointer-events-none" />
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3 relative z-10">
        <div className="flex-1">
          <h3 className="font-bold text-gray-900 text-lg leading-tight uppercase tracking-tight">{product_name}</h3>
          {serving_size && <p className="text-sm text-gray-600 font-medium mt-0.5 opacity-80">Per {serving_size}</p>}
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border-2 text-xs font-black uppercase tracking-widest ${cfg.badge} shadow-sm`}>
          <span>{cfg.icon}</span>
          <span>{verdict}</span>
        </div>
      </div>

      {/* Confidence warning */}
      {confidence === 'low' && confidence_note && (
        <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-xl p-3 text-sm text-orange-700">
          <span className="text-base">🔍</span>
          <p>{confidence_note}</p>
        </div>
      )}

      {/* Reason */}
      <p className={`text-base font-medium ${cfg.text}`}>{reason}</p>

      {/* Agent Reply */}
      {analysis.agent_reply && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-blue-900 shadow-sm mt-2">
          <div className="flex items-start gap-3">
            <span className="text-2xl mt-0.5">🤖</span>
            <p className="text-sm font-medium italic leading-relaxed">
              "{analysis.agent_reply}"
            </p>
          </div>
        </div>
      )}

      {/* Nutrients grid */}
      {nutrients && Object.values(nutrients).some(v => v !== null) && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Sodium', value: nutrients.sodium_mg, unit: 'mg', warn: 400 },
            { label: 'Sugar', value: nutrients.sugar_g, unit: 'g', warn: 12 },
            { label: 'Potassium', value: nutrients.potassium_mg, unit: 'mg', warn: 400 },
            { label: 'Phosphorus', value: nutrients.phosphorus_mg, unit: 'mg', warn: 200 },
            { label: 'Protein', value: nutrients.protein_g, unit: 'g', warn: null },
            { label: 'Calories', value: nutrients.calories, unit: 'kcal', warn: null },
          ]
            .filter(n => n.value !== null && n.value !== undefined)
            .map(({ label, value, unit, warn }) => (
              <div
                key={label}
                className={`bg-white rounded-xl p-2 text-center border ${
                  warn && value > warn ? 'border-red-200 bg-red-50' : 'border-gray-100'
                }`}
              >
                <div className="text-sm font-bold text-gray-900">{value}{unit}</div>
                <div className="text-xs text-gray-500">{label}</div>
              </div>
            ))}
        </div>
      )}

      {/* Disclaimer */}
      <p className="text-xs text-gray-400 italic">
        ⚕️ This is guidance based on your numbers — always confirm medical decisions with your doctor.
      </p>

      {/* Add to cart */}
      {onAddToCart && (
        <button
          onClick={onAddToCart}
          className="w-full btn-primary flex items-center justify-center gap-2"
        >
          <span>🛒</span> Add to Cart
        </button>
      )}
    </div>
  );
}
