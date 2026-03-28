import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { generateMealPlan } from '../utils/api.js';
import PlanAssistant from '../components/PlanAssistant.jsx';

const SECTION_ICONS = {
  Produce: '🥦',
  Proteins: '🥩',
  'Grains & Legumes': '🌾',
  'Dairy & Alternatives': '🥛',
  'Pantry & Condiments': '🫙',
};

const DIET_TYPES = [
  { key: 'Vegetarian', label: 'Vegetarian' },
  { key: 'Vegan', label: 'Vegan' },
  { key: 'Keto', label: 'Keto' },
  { key: 'Gluten-Free', label: 'Gluten-Free' },
  { key: 'Low Sodium', label: 'Low Sodium' },
  { key: 'Diabetic', label: 'Diabetic' },
];

export default function Planner() {
  const { healthProfile } = useApp();
  const [budget, setBudget] = useState(70);
  const [dietTypes, setDietTypes] = useState([]);
  const [allergies, setAllergies] = useState('');
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function toggleDiet(key) {
    setDietTypes(prev => prev.includes(key) ? prev.filter(d => d !== key) : [...prev, key]);
  }

  async function handleGenerate() {
    const b = parseFloat(budget);
    if (!b || b <= 0) { setError('Please enter a valid budget.'); return; }
    setError('');
    setLoading(true);
    setPlan(null);
    const preferences = [
      ...dietTypes,
      allergies ? `allergies: ${allergies}` : '',
    ].filter(Boolean).join(', ');
    try {
      const { plan: result } = await generateMealPlan(b, preferences, healthProfile);
      setPlan(result);
    } catch (e) {
      setError(e.message || 'Failed to generate plan. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const totalCost = plan?.total_estimated_cost || 0;
  const remaining = budget - totalCost;

  return (
    <div className="min-h-screen" style={{ background: '#f5f5f5' }}>
      {/* Topbar */}
      <div className="iris-topbar">
        <div style={{
          width: 36, height: 36, borderRadius: '50%', background: 'var(--green-mid)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
        }}>📋</div>
        <span className="iris-topbar-title">Weekly Grocery List</span>
        <span style={{ fontSize: 18 }}>🌿</span>
      </div>

      <div style={{ maxWidth: 500, margin: '0 auto', paddingBottom: 100 }}>

        {/* Budget section */}
        <div style={{
          background: 'var(--green-mid)', padding: '20px 20px 16px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: 600, letterSpacing: '0.5px', marginBottom: 6 }}>
            Weekly Budget
          </div>
          <div style={{ fontFamily: 'Inter', fontSize: 40, fontWeight: 800, color: '#fff', lineHeight: 1 }}>
            ${budget}
          </div>
          <input
            type="range"
            min="40" max="300" step="5"
            value={budget}
            onChange={e => setBudget(Number(e.target.value))}
            style={{ width: '80%', marginTop: 12, accentColor: 'var(--amber)' }}
          />
        </div>

        {/* Diet filters */}
        <div style={{ padding: '14px 16px 0', overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: 8, paddingBottom: 4 }}>
            {DIET_TYPES.map(({ key, label }) => {
              const active = dietTypes.includes(key);
              return (
                <button
                  key={key}
                  onClick={() => toggleDiet(key)}
                  style={{
                    padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                    border: active ? '2px solid var(--green-mid)' : '1.5px solid #D8D0C8',
                    background: active ? 'var(--green-mid)' : '#fff',
                    color: active ? '#fff' : 'var(--text-mid)',
                    cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap', fontFamily: 'inherit',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Allergies input */}
        <div style={{ padding: '12px 16px 0' }}>
          <input
            type="text"
            className="input-field"
            placeholder="Allergies (e.g. peanuts, shellfish)…"
            value={allergies}
            onChange={e => setAllergies(e.target.value)}
          />
        </div>

        {/* Health profile conditions */}
        {healthProfile?.conditions?.length > 0 && (
          <div style={{ padding: '8px 16px 0', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {healthProfile.conditions.map(c => (
              <span key={c} style={{
                fontSize: 11, background: 'var(--green-bg)', color: 'var(--green-dark)',
                border: '1px solid var(--green-pale)', borderRadius: 20, padding: '3px 10px', fontWeight: 600,
              }}>
                {c.replace('_', ' ')}
              </span>
            ))}
          </div>
        )}

        {error && (
          <div style={{ margin: '12px 16px 0', padding: '10px 14px', background: 'var(--avoid-bg)', border: '1px solid #FFCDD2', borderRadius: 'var(--radius-sm)', color: 'var(--avoid)', fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Generate button */}
        <div style={{ padding: '14px 16px 0' }}>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="btn-primary"
            style={{ width: '100%', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            {loading ? (
              <>
                <div className="w-4 h-4 spinner" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
                Building your list…
              </>
            ) : (
              '📋 Generate My List'
            )}
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="card" style={{ margin: '14px 16px', textAlign: 'center', padding: '24px 16px' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🥦</div>
            <p style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>Crafting your personalized grocery list…</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Checking every item against your health profile</p>
          </div>
        )}

        {/* Plan output */}
        {plan && !loading && (
          <div className="slide-up">
            {/* Voice assistant */}
            <div style={{ padding: '14px 16px 0' }}>
              <PlanAssistant plan={plan} healthProfile={healthProfile} />
            </div>

            {/* Grocery sections */}
            <div style={{ padding: '14px 0 0' }}>
              {Object.entries(plan.sections || {}).map(([section, items]) => {
                if (!items || items.length === 0) return null;
                const icon = SECTION_ICONS[section] || '🛒';
                return (
                  <div key={section}>
                    <div style={{
                      padding: '8px 20px',
                      background: 'var(--green-bg)',
                      fontSize: 12, fontWeight: 800, color: 'var(--green-dark)',
                      textTransform: 'uppercase', letterSpacing: '0.8px',
                      borderTop: '1px solid var(--green-pale)', borderBottom: '1px solid var(--green-pale)',
                    }}>
                      {icon} {section}
                    </div>
                    {items.map((item, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '12px 16px', background: '#fff',
                        borderBottom: '1px solid #F5F0EA',
                      }}>
                        <div style={{
                          width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                          background: 'var(--green-bg)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
                        }}>
                          {icon}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                            {item.item}
                            {item.flag && (
                              <span style={{
                                marginLeft: 8, fontSize: 10, fontWeight: 700,
                                background: 'var(--amber-light)', color: '#7A5000',
                                border: '1px solid #F0C870', borderRadius: 20, padding: '2px 8px',
                              }}>{item.flag}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--safe)', fontWeight: 600 }}>✓ Safe for your profile</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.quantity}</div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                            ${(item.estimated_cost || 0).toFixed(2)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            {/* Meal ideas */}
            {plan.weekly_meal_ideas?.length > 0 && (
              <div className="card" style={{ margin: '14px 16px 0' }}>
                <h3 style={{ fontFamily: 'Inter', fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  🍽️ Meal Ideas This Week
                </h3>
                {plan.weekly_meal_ideas.slice(0, 3).map((idea, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--text-mid)', marginBottom: 6 }}>
                    <span style={{ color: 'var(--safe)', flexShrink: 0 }}>•</span>
                    <span>{idea}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Shopping tips */}
            {plan.shopping_tips?.length > 0 && (
              <div className="card" style={{ margin: '14px 16px 0', background: '#EEF6FF', border: '1px solid #BFDBFE' }}>
                <h3 style={{ fontFamily: 'Inter', fontSize: 14, fontWeight: 700, color: '#1D4ED8', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  💡 Shopping Tips
                </h3>
                {plan.shopping_tips.slice(0, 2).map((tip, i) => (
                  <p key={i} style={{ fontSize: 13, color: '#1E40AF', marginBottom: 4 }}>• {tip}</p>
                ))}
              </div>
            )}

            {/* Avoid list */}
            {plan.items_to_avoid?.length > 0 && (
              <div className="card" style={{ margin: '14px 16px 0', background: 'var(--avoid-bg)', border: '1px solid #FFCDD2' }}>
                <h3 style={{ fontFamily: 'Inter', fontSize: 14, fontWeight: 700, color: 'var(--avoid)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  🚫 Skip These
                </h3>
                {plan.items_to_avoid.map((item, i) => (
                  <p key={i} style={{ fontSize: 13, color: '#B71C1C', marginBottom: 4 }}>• {item}</p>
                ))}
              </div>
            )}

            {/* Budget note */}
            {plan.budget_note && (
              <div style={{ margin: '14px 16px 0', padding: '10px 14px', background: 'var(--amber-light)', border: '1px solid #F0C870', borderRadius: 'var(--radius-sm)', fontSize: 13, color: '#7A5000' }}>
                💡 {plan.budget_note}
              </div>
            )}

            {/* Total footer */}
            <div style={{
              background: '#fff', borderTop: '2px solid var(--green-bg)',
              padding: '16px 20px', margin: '14px 0 0',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Estimated Total</div>
                  {remaining >= 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--safe)', fontWeight: 600, marginTop: 2 }}>
                      ${remaining.toFixed(2)} remaining in budget
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--avoid)', fontWeight: 600, marginTop: 2 }}>
                      ${Math.abs(remaining).toFixed(2)} over budget
                    </div>
                  )}
                </div>
                <div style={{ fontFamily: 'Inter', fontSize: 28, fontWeight: 800, color: 'var(--green-dark)' }}>
                  ${totalCost.toFixed(2)}
                </div>
              </div>
              <button onClick={handleGenerate} className="btn-secondary" style={{ width: '100%', textAlign: 'center' }}>
                🔄 Regenerate Plan
              </button>
            </div>

            <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', padding: '10px 16px 0' }}>
              ⚕️ This plan is guidance — always confirm with your doctor.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
