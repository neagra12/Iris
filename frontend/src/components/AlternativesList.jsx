import { useState, useEffect } from 'react';

function AlternativeItem({ alt, index = 0 }) {
  const [imageUrl, setImageUrl] = useState(null);
  const [imgLoading, setImgLoading] = useState(true);

  // Try every field name Claude might use for the product name
  const altName =
    alt.name || alt.product_name || alt.swap_in || alt.title ||
    alt.product || alt.suggestion || alt.alternative || alt.item ||
    alt.alternative_name || alt.recommended_product || alt.swap ||
    Object.values(alt).find(v => typeof v === 'string' && v.length > 3 && v.length < 100) ||
    'Alternative Product';

  useEffect(() => {
    if (altName === 'Alternative Product') {
      setImgLoading(false);
      return;
    }

    const controller = new AbortController();

    const runFetch = async () => {
      // Stagger requests slightly for a better visual pop-in effect
      await new Promise(r => setTimeout(r, index * 250));
      if (controller.signal.aborted) return;

      try {
        const res = await fetch(`/api/image-search?q=${encodeURIComponent(altName)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (data.imageUrl) setImageUrl(data.imageUrl);
      } catch (err) {
        if (err.name !== 'AbortError') console.error('Image fetch failed for', altName);
      } finally {
        setImgLoading(false);
      }
    };

    runFetch();
    return () => controller.abort();
  }, [altName, index]);

  return (
    <div className="bg-white border rounded-xl overflow-hidden flex items-stretch shadow-sm hover:shadow-md transition-all">
      {/* Image slot */}
      <div className="w-24 h-24 bg-gray-50 flex-shrink-0 border-r border-gray-100 flex items-center justify-center p-2">
        {imgLoading ? (
          <div className="w-6 h-6 rounded-full border-2 border-gray-200 border-t-green-500 animate-spin" />
        ) : imageUrl ? (
          <img
            src={imageUrl}
            alt={altName}
            className="w-full h-full object-contain mix-blend-multiply"
            onError={() => setImageUrl(null)}
          />
        ) : (
          <div className="text-3xl opacity-40">🛒</div>
        )}
      </div>

      {/* Content */}
      <div className="p-3 flex-1 flex flex-col justify-center">
        <p className="font-bold text-gray-900 leading-tight mb-1">{altName}</p>
        <p className="text-xs text-green-700 leading-snug">{alt.reason || alt.why || alt.description || alt.benefit || ''}</p>
      </div>
    </div>
  );
}

export default function AlternativesList({ alternatives }) {
  if (!alternatives || alternatives.length === 0) return null;

  return (
    <div className="space-y-3">
      <h4 className="font-bold text-gray-800 flex items-center gap-2 px-1">
        <span>💡</span> Better Alternatives
      </h4>
      <div className="grid gap-3">
        {alternatives.map((alt, i) => (
          <AlternativeItem key={`${alt.name || alt.product_name || i}-${i}`} alt={alt} index={i} />
        ))}
      </div>
    </div>
  );
}
