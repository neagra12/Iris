import { useApp } from '../context/AppContext.jsx';
import { useNavigate } from 'react-router-dom';

export default function Profile() {
  const { healthProfile, resetProfile } = useApp();
  const navigate = useNavigate();

  if (!healthProfile) return null;

  const { conditions, markers, limits, medications } = healthProfile;

  function handleReset() {
    if (confirm("Reset your health profile? You'll need to re-enter it.")) {
      resetProfile();
      navigate('/onboarding');
    }
  }

  return (
    <div className="min-h-screen" style={{ background: '#f5f5f5' }}>
      {/* Topbar */}
      <div className="iris-topbar">
        <img src="/iris_goldbg.png" alt="IRIS" style={{ width: 32, height: 32, borderRadius: 8 }} />
        <span className="iris-topbar-title">Your Health Profile</span>
      </div>

      {/* Hero strip */}
      <div style={{
        background: 'var(--green-light)', padding: '20px 20px 24px', textAlign: 'center',
      }}>
        <div style={{ fontFamily: 'Inter', fontSize: 24, fontWeight: 800, color: '#fff', letterSpacing: 2, marginBottom: 4 }}>IRIS</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', letterSpacing: '1px' }}>
          Intelligent Retail &amp; Ingredient Scanner
        </div>
        {conditions?.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 6 }}>
            {conditions.slice(0, 2).map(c => (
              <span key={c} style={{
                background: 'rgba(255,255,255,0.15)', borderRadius: 20,
                padding: '5px 12px', fontSize: 11, color: '#fff', fontWeight: 600,
              }}>
                {c.replace('_', ' ')}
              </span>
            ))}
            {conditions.length > 2 && (
              <span style={{
                background: 'rgba(255,255,255,0.10)', borderRadius: 20,
                padding: '5px 12px', fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: 600,
              }}>
                +{conditions.length - 2} more
              </span>
            )}
          </div>
        )}
      </div>

      <div style={{ maxWidth: 500, margin: '0 auto', padding: '16px 16px 120px' }}>

        {/* Medications */}
        {medications?.length > 0 && (
          <div className="card" style={{ marginBottom: 14 }}>
            <h2 style={{ fontFamily: 'Inter', fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              💊 Medications
            </h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {medications.map(m => (
                <span key={m} style={{
                  background: 'var(--amber-light)', color: '#7A5000',
                  border: '1px solid #F0C870', borderRadius: 20,
                  padding: '5px 12px', fontSize: 12, fontWeight: 600,
                }}>{m}</span>
              ))}
            </div>
          </div>
        )}

        {/* Daily Limits */}
        <div className="card" style={{ marginBottom: 14, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #F0EBE4' }}>
            <h2 style={{ fontFamily: 'Inter', fontSize: 14, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
              📊 Daily Limits
            </h2>
          </div>
          {[
            { key: 'sodium_daily_mg', label: 'Sodium', unit: 'mg' },
            { key: 'sugar_daily_g', label: 'Sugar', unit: 'g' },
            { key: 'potassium_daily_mg', label: 'Potassium', unit: 'mg' },
            { key: 'phosphorus_daily_mg', label: 'Phosphorus', unit: 'mg' },
            { key: 'protein_daily_g', label: 'Protein', unit: 'g' },
            { key: 'calories_daily', label: 'Calories', unit: 'kcal' },
          ].map(({ key, label, unit }, i, arr) => (
            <div key={key} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 16px',
              borderBottom: i < arr.length - 1 ? '1px solid #F5F0EA' : 'none',
            }}>
              <span style={{ fontSize: 14, color: 'var(--text-mid)', fontWeight: 500 }}>{label}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                {limits?.[key] ?? '—'} {unit}
              </span>
            </div>
          ))}
        </div>

        {/* Lab Values */}
        {markers && Object.values(markers).some(v => v !== null && v !== undefined) && (
          <div className="card" style={{ marginBottom: 14, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #F0EBE4' }}>
              <h2 style={{ fontFamily: 'Inter', fontSize: 14, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                🔬 Lab Values
              </h2>
            </div>
            <div style={{ padding: '0 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
              {[
                { key: 'fasting_glucose', label: 'Fasting Glucose', unit: 'mg/dL', normal: '<100' },
                { key: 'hba1c', label: 'HbA1c', unit: '%', normal: '<5.7%' },
                { key: 'creatinine', label: 'Creatinine', unit: 'mg/dL', normal: '0.6–1.2' },
                { key: 'gfr', label: 'GFR', unit: 'mL/min', normal: '>60' },
                { key: 'cholesterol_total', label: 'Total Cholesterol', unit: 'mg/dL', normal: '<200' },
                { key: 'ldl', label: 'LDL', unit: 'mg/dL', normal: '<100' },
                { key: 'hdl', label: 'HDL', unit: 'mg/dL', normal: '>40' },
                { key: 'blood_pressure_systolic', label: 'Systolic BP', unit: 'mmHg', normal: '<120' },
              ].filter(({ key }) => markers?.[key] != null).map(({ key, label, unit, normal }, i, arr) => (
                <div key={key} style={{
                  padding: '12px 0',
                  borderBottom: i < arr.length - 2 ? '1px solid #F5F0EA' : 'none',
                  borderRight: i % 2 === 0 ? '1px solid #F5F0EA' : 'none',
                  paddingRight: i % 2 === 0 ? 16 : 0,
                  paddingLeft: i % 2 === 1 ? 16 : 0,
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{label}</div>
                  <div style={{ fontFamily: 'Inter', fontSize: 18, fontWeight: 800, color: 'var(--safe)', marginTop: 2 }}>
                    {markers[key]} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>{unit}</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Normal: {normal}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reset */}
        <button
          onClick={handleReset}
          style={{
            width: '100%', padding: '14px', borderRadius: 'var(--radius-sm)',
            border: '1.5px solid #FFCDD2', color: 'var(--avoid)',
            background: '#fff', fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 14, transition: 'all 0.2s',
          }}
        >
          Reset Profile
        </button>

        <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
          🔒 Profile stored locally on your device only.
        </p>
      </div>
    </div>
  );
}
