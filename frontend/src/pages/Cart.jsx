import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { analyzeCart } from '../utils/api.js';

const GRADE_COLORS = {
  A: { bg: 'var(--safe-bg)', color: 'var(--safe)', border: '#B2DFBB' },
  B: { bg: '#E3F2FD', color: '#1565C0', border: '#90CAF9' },
  C: { bg: 'var(--amber-light)', color: '#7A5000', border: '#FFCC80' },
  D: { bg: '#FFF3E0', color: '#BF360C', border: '#FFCC80' },
  F: { bg: 'var(--avoid-bg)', color: 'var(--avoid)', border: '#FFCDD2' },
};

function NutrientBar({ label, current, limit, unit }) {
  if (!limit) return null;
  const pct = Math.min(100, Math.round((current / limit) * 100));
  const barClass = pct > 90 ? 'n-bar-red' : pct > 70 ? 'n-bar-amber' : 'n-bar-green';
  const pctColor = pct > 90 ? 'var(--avoid)' : pct > 70 ? 'var(--caution)' : 'var(--safe)';
  const overLimit = pct >= 100;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
        <span style={{ fontSize: 12, color: pctColor, fontWeight: 600 }}>
          {pct}%{' '}
          <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11 }}>
            {current?.toFixed?.(0) ?? 0}{unit} / {limit}{unit}
          </span>
        </span>
      </div>
      <div style={{ height: 7, background: '#EEE8E0', borderRadius: 4, overflow: 'hidden' }}>
        <div className={barClass} style={{ height: '100%', width: `${pct}%`, borderRadius: 4, transition: 'width 0.5s' }} />
      </div>
      {overLimit && (
        <div style={{ fontSize: 11, color: 'var(--avoid)', marginTop: 3, fontWeight: 600 }}>
          ⚠ {Math.round(current - limit)}{unit} over your daily {label.toLowerCase()} limit
        </div>
      )}
    </div>
  );
}

const VERDICT_TAG = {
  Safe:    { bg: 'var(--safe-bg)', color: 'var(--safe)', border: '#B2DFBB' },
  Caution: { bg: 'var(--caution-bg)', color: 'var(--caution)', border: '#FFCC80' },
  Avoid:   { bg: 'var(--avoid-bg)', color: 'var(--avoid)', border: '#FFCDD2' },
};

function itemThumbBg(verdict) {
  if (verdict === 'Avoid') return '#FFEBEE';
  if (verdict === 'Caution') return '#FFF8E1';
  return '#E8F5E9';
}

export default function Cart() {
  const { cart, healthProfile, removeFromCart, clearCart } = useApp();
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const totals = cart.reduce((acc, item) => {
    const n = item.nutrients || {};
    acc.sodium_mg += n.sodium_mg || 0;
    acc.sugar_g += n.sugar_g || 0;
    acc.potassium_mg += n.potassium_mg || 0;
    acc.calories += n.calories || 0;
    return acc;
  }, { sodium_mg: 0, sugar_g: 0, potassium_mg: 0, calories: 0 });

  const limits = healthProfile?.limits || {};

  async function handleAnalyze(query) {
    if (cart.length === 0) return;
    setLoading(true);
    setError('');
    setAnalysis(null);
    try {
      const { result } = await analyzeCart(cart, healthProfile, query);
      setAnalysis(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (cart.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center gap-4" style={{ background: '#f5f5f5' }}>
        <div style={{ fontSize: 64 }}>🛒</div>
        <h2 style={{ fontFamily: 'Inter', fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>Your cart is empty</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, maxWidth: 280 }}>
          Scan products in the Scanner tab to add them here.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: '#f5f5f5' }}>
      {/* Topbar */}
      <div className="iris-topbar">
        <div style={{
          width: 36, height: 36, borderRadius: '50%', background: 'var(--green-mid)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
        }}>🛒</div>
        <span className="iris-topbar-title">My Cart Summary</span>
        <div style={{
          background: 'var(--green-bg)', color: 'var(--green-dark)', fontSize: 12,
          fontWeight: 700, padding: '4px 10px', borderRadius: 20, border: '1px solid var(--green-pale)',
        }}>
          {cart.length} item{cart.length !== 1 ? 's' : ''}
        </div>
        <button
          onClick={() => { clearCart(); setAnalysis(null); }}
          style={{ fontSize: 12, color: 'var(--avoid)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', marginLeft: 4 }}
        >
          Clear
        </button>
      </div>

      <div style={{ maxWidth: 500, margin: '0 auto', padding: '16px 16px 100px' }}>

        {/* Nutrient totals */}
        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h3 style={{ fontFamily: 'Inter', fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
              Today's Nutrient Totals
            </h3>
            <button
              onClick={() => handleAnalyze("How's my cart looking? Give me a detailed breakdown.")}
              disabled={loading}
              style={{
                padding: '6px 14px', background: 'var(--green-mid)', color: '#fff',
                border: 'none', borderRadius: 20, fontSize: 12, fontWeight: 600,
                cursor: 'pointer', opacity: loading ? 0.6 : 1, fontFamily: 'inherit',
              }}
            >
              {loading ? '…' : "How's my cart?"}
            </button>
          </div>
          <NutrientBar label="Sodium" current={totals.sodium_mg} limit={limits.sodium_daily_mg} unit="mg" />
          <NutrientBar label="Sugar" current={totals.sugar_g} limit={limits.sugar_daily_g} unit="g" />
          <NutrientBar label="Potassium" current={totals.potassium_mg} limit={limits.potassium_daily_mg} unit="mg" />
          <NutrientBar label="Calories" current={totals.calories} limit={limits.calories_daily} unit="kcal" />
        </div>

        {/* Cart items */}
        <div className="card" style={{ marginBottom: 14, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid #F0EBE4' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              Cart Items
            </span>
          </div>
          {cart.map((item, idx) => {
            const tag = VERDICT_TAG[item.verdict] || VERDICT_TAG.Caution;
            return (
              <div key={item.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                borderBottom: idx < cart.length - 1 ? '1px solid #F5F0EA' : 'none',
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  background: itemThumbBg(item.verdict),
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
                }}>
                  {item.verdict === 'Avoid' ? '⚠️' : item.verdict === 'Caution' ? '🟡' : '✅'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.product_name}
                  </div>
                  {item.nutrients && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {item.nutrients.sodium_mg ? <span>Na: {item.nutrients.sodium_mg}mg</span> : null}
                      {item.nutrients.sugar_g ? <span>Sugar: {item.nutrients.sugar_g}g</span> : null}
                      {item.nutrients.calories ? <span>{item.nutrients.calories}kcal</span> : null}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{
                    padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                    background: tag.bg, color: tag.color, border: `1px solid ${tag.border}`,
                  }}>
                    {item.verdict}
                  </span>
                  <button
                    onClick={() => removeFromCart(item.id)}
                    style={{ fontSize: 18, color: '#CCC', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}
                    title="Remove"
                  >×</button>
                </div>
              </div>
            );
          })}
        </div>

        {/* End trip button */}
        <button
          onClick={() => handleAnalyze("Give me an end-of-trip summary with your top swap suggestions.")}
          disabled={loading}
          className="btn-primary"
          style={{ width: '100%', fontSize: 15, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          {loading ? (
            <>
              <div className="w-4 h-4 spinner" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
              Analyzing…
            </>
          ) : (
            'End Trip · Full Report →'
          )}
        </button>

        {error && (
          <div style={{ padding: '12px 16px', background: 'var(--avoid-bg)', border: '1px solid #FFCDD2', borderRadius: 'var(--radius-sm)', color: 'var(--avoid)', fontSize: 13, marginBottom: 14 }}>
            {error}
          </div>
        )}

        {/* Analysis result */}
        {analysis && !loading && (
          <div className="slide-up" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Grade */}
            <div className="card" style={{ textAlign: 'center' }}>
              {(() => {
                const g = GRADE_COLORS[analysis.overall_grade] || GRADE_COLORS.C;
                return (
                  <>
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 64, height: 64, borderRadius: '50%',
                      background: g.bg, color: g.color, border: `2px solid ${g.border}`,
                      fontSize: 28, fontWeight: 800, fontFamily: 'Inter', marginBottom: 10,
                    }}>
                      {analysis.overall_grade}
                    </div>
                    <p style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>
                      {analysis.summary}
                    </p>
                    {analysis.encouragement && (
                      <p style={{ color: 'var(--safe)', fontSize: 13, marginTop: 6 }}>{analysis.encouragement}</p>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Swaps */}
            {analysis.swap_suggestions?.length > 0 && (
              <div className="card">
                <h3 style={{ fontFamily: 'Inter', fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  🔄 Smart Swaps
                </h3>
                {analysis.swap_suggestions.map((swap, i) => (
                  <div key={i} style={{
                    background: 'var(--green-bg)', border: '1px solid var(--green-pale)',
                    borderRadius: 'var(--radius-sm)', padding: '10px 12px', marginBottom: 8,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <span style={{ color: 'var(--avoid)', textDecoration: 'line-through' }}>{swap.swap_out}</span>
                      <span style={{ color: 'var(--text-muted)' }}>→</span>
                      <span style={{ color: 'var(--safe)', fontWeight: 600 }}>{swap.swap_in}</span>
                    </div>
                    {swap.reason && <div style={{ fontSize: 11, color: 'var(--green-dark)', marginTop: 4 }}>{swap.reason}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* Problem items */}
            {analysis.problem_items?.length > 0 && (
              <div className="card">
                <h3 style={{ fontFamily: 'Inter', fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  ⚠️ Watch These Items
                </h3>
                {analysis.problem_items.map((item, i) => {
                  const tag = VERDICT_TAG[item.verdict] || VERDICT_TAG.Caution;
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8, fontSize: 13 }}>
                      <span style={{
                        padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, flexShrink: 0,
                        background: tag.bg, color: tag.color, border: `1px solid ${tag.border}`,
                      }}>{item.verdict}</span>
                      <div>
                        <span style={{ fontWeight: 600 }}>{item.item}</span>
                        {item.issue && <span style={{ color: 'var(--text-muted)' }}> — {item.issue}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              ⚕️ Always confirm medical decisions with your doctor.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
