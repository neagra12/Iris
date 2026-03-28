import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { extractProfile } from '../utils/api.js';

const DEMO_PROFILE = {
  conditions: ['diabetes', 'hypertension'],
  medications: ['Metformin', 'Lisinopril'],
  markers: {
    fasting_glucose: 148,
    hba1c: 7.8,
    creatinine: 1.1,
    gfr: 68,
    cholesterol_total: 215,
    ldl: 138,
    hdl: 42,
    blood_sodium: 141,
    blood_potassium: 4.3,
    blood_pressure_systolic: 138,
    blood_pressure_diastolic: 88,
  },
  limits: {
    sodium_daily_mg: 1500,
    potassium_daily_mg: 4700,
    sugar_daily_g: 25,
    phosphorus_daily_mg: 1000,
    protein_daily_g: 50,
    calories_daily: 1800,
  },
  estimated_fields: [],
};

const CONDITIONS_LIST = [
  { key: 'diabetes', label: 'Diabetes' },
  { key: 'prediabetes', label: 'Prediabetes' },
  { key: 'hypertension', label: 'Hypertension' },
  { key: 'high_cholesterol', label: 'High Cholesterol' },
  { key: 'CKD', label: 'Kidney Disease (CKD)' },
  { key: 'heart_disease', label: 'Heart Disease' },
  { key: 'anemia', label: 'Anemia' },
  { key: 'celiac', label: 'Celiac Disease' },
  { key: 'lactose_intolerance', label: 'Lactose Intolerance' },
  { key: 'thyroid', label: 'Thyroid Disorder' },
];

// Build quick-view chips from extracted profile (shown on home screen after upload)
function buildVitalsChips(profile) {
  const chips = [];
  const m = profile?.markers || {};
  const l = profile?.limits || {};

  if (m.hba1c != null)             chips.push({ label: `HbA1c: ${m.hba1c}%`,          level: m.hba1c > 6.5 ? 'caution' : 'safe' });
  if (m.fasting_glucose != null)   chips.push({ label: `Glucose: ${m.fasting_glucose} mg/dL`, level: m.fasting_glucose > 126 ? 'avoid' : m.fasting_glucose > 100 ? 'caution' : 'safe' });
  if (m.gfr != null)               chips.push({ label: `GFR: ${m.gfr}`,                level: m.gfr < 60 ? 'avoid' : m.gfr < 90 ? 'caution' : 'safe' });
  if (l.sodium_daily_mg != null)   chips.push({ label: `Na limit: ${l.sodium_daily_mg}mg/day`, level: l.sodium_daily_mg <= 1500 ? 'caution' : 'safe' });
  if (m.ldl != null)               chips.push({ label: `LDL: ${m.ldl} mg/dL`,          level: m.ldl > 130 ? 'caution' : 'safe' });
  if (m.blood_pressure_systolic != null) chips.push({ label: `BP: ${m.blood_pressure_systolic} mmHg`, level: m.blood_pressure_systolic > 140 ? 'avoid' : m.blood_pressure_systolic > 120 ? 'caution' : 'safe' });
  if (m.creatinine != null)        chips.push({ label: `Creatinine: ${m.creatinine}`,  level: m.creatinine > 1.2 ? 'caution' : 'safe' });
  if (m.hdl != null)               chips.push({ label: `HDL: ${m.hdl} mg/dL`,          level: m.hdl < 40 ? 'caution' : 'safe' });

  return chips;
}

// Build full vitals list for the modal (all markers + limits)
function buildAllVitals(profile) {
  const rows = [];
  const m = profile?.markers || {};
  const l = profile?.limits || {};
  const c = profile?.conditions || [];

  const MARKER_LABELS = {
    fasting_glucose: ['Fasting Glucose', 'mg/dL'],
    hba1c: ['HbA1c', '%'],
    creatinine: ['Creatinine', 'mg/dL'],
    gfr: ['GFR', 'mL/min'],
    cholesterol_total: ['Total Cholesterol', 'mg/dL'],
    ldl: ['LDL', 'mg/dL'],
    hdl: ['HDL', 'mg/dL'],
    blood_sodium: ['Blood Sodium', 'mmol/L'],
    blood_potassium: ['Blood Potassium', 'mmol/L'],
    blood_pressure_systolic: ['BP Systolic', 'mmHg'],
    blood_pressure_diastolic: ['BP Diastolic', 'mmHg'],
  };

  const LIMIT_LABELS = {
    sodium_daily_mg: ['Sodium Limit', 'mg/day'],
    potassium_daily_mg: ['Potassium Limit', 'mg/day'],
    sugar_daily_g: ['Sugar Limit', 'g/day'],
    phosphorus_daily_mg: ['Phosphorus Limit', 'mg/day'],
    protein_daily_g: ['Protein Limit', 'g/day'],
    calories_daily: ['Calorie Limit', 'kcal/day'],
  };

  if (c.length > 0) {
    rows.push({ section: 'Conditions' });
    c.forEach(cond => rows.push({ name: cond.replace(/_/g, ' '), value: '✓', isCondition: true }));
  }

  const markerRows = Object.entries(MARKER_LABELS)
    .filter(([key]) => m[key] != null)
    .map(([key, [label, unit]]) => ({ name: label, value: `${m[key]} ${unit}` }));

  if (markerRows.length > 0) {
    rows.push({ section: 'Lab Markers' });
    rows.push(...markerRows);
  }

  const limitRows = Object.entries(LIMIT_LABELS)
    .filter(([key]) => l[key] != null)
    .map(([key, [label, unit]]) => ({ name: label, value: `${l[key]} ${unit}` }));

  if (limitRows.length > 0) {
    rows.push({ section: 'Daily Limits' });
    rows.push(...limitRows);
  }

  return rows;
}

const CHIP_STYLE = {
  safe:    { bg: 'var(--green-bg)',    color: 'var(--green-dark)',  border: 'var(--green-pale)' },
  caution: { bg: 'var(--caution-bg)', color: 'var(--caution)',     border: '#FFCC80' },
  avoid:   { bg: 'var(--avoid-bg)',   color: 'var(--avoid)',       border: '#FFCDD2' },
};

export default function Onboarding() {
  const navigate = useNavigate();
  const { saveProfile, DEFAULT_PROFILE } = useApp();
  const fileRef = useRef(null);

  const [step, setStep] = useState('upload'); // upload | loading | review
  const [error, setError] = useState('');
  const [editProfile, setEditProfile] = useState(null);
  const [showModal, setShowModal] = useState(false);

  async function processFile(file) {
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      setError('Please upload a JPEG, PNG, WebP, or PDF file.');
      return;
    }
    setError('');
    setStep('loading');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { profile } = await extractProfile(fd);
      setEditProfile(profile);
      setStep('vitals'); // ← new step: show vitals before review
    } catch (e) {
      setError(`Failed to read lab report: ${e.message}. You can enter values manually.`);
      setEditProfile({ ...DEFAULT_PROFILE });
      setStep('review');
    }
  }

  function useDemo() {
    setEditProfile(DEMO_PROFILE);
    setStep('vitals');
  }

  function useManual() {
    setEditProfile({ ...DEFAULT_PROFILE });
    setStep('review');
  }

  function updateLimit(key, val) {
    setEditProfile(p => ({ ...p, limits: { ...p.limits, [key]: Number(val) } }));
  }

  function updateMarker(key, val) {
    setEditProfile(p => ({ ...p, markers: { ...p.markers, [key]: val ? Number(val) : null } }));
  }

  function toggleCondition(cond) {
    setEditProfile(p => {
      const has = p.conditions.includes(cond);
      const conds = has ? p.conditions.filter(c => c !== cond) : [...p.conditions, cond];
      return { ...p, conditions: conds };
    });
  }

  function handleSave() {
    saveProfile(editProfile);
    navigate('/scanner');
  }

  // ── Upload step ─────────────────────────────────────────────────────────
  if (step === 'upload') {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: '#f5f5f5' }}>
        {/* Hero */}
        <div style={{
          background: 'var(--green-light)', padding: '28px 24px 32px',
          textAlign: 'center', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', width: 200, height: 200,
            background: 'rgba(255,255,255,0.10)', borderRadius: '50%',
            top: -60, right: -60,
          }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 6 }}>
            <img src="/iris_white.png" alt="IRIS" style={{ width: 32, height: 32 }} />
            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 28, fontWeight: 700, color: '#fff', letterSpacing: 3 }}>IRIS</span>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 14 }}>
            Intelligent Retail &amp; Ingredient Scanner
          </div>
          <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 22, color: '#fff', lineHeight: 1.3, marginBottom: 16 }}>
            Grocery shopping,<br />built around your health.
          </div>
          <div style={{
            width: 120, height: 90, margin: '0 auto',
            background: 'rgba(255,255,255,0.08)', borderRadius: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 50, border: '1px solid rgba(255,255,255,0.15)',
          }}>🧺</div>
          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center', gap: 8 }}>
            {['Diabetes', 'Hypertension', 'CKD'].map(c => (
              <div key={c} style={{
                background: 'rgba(255,255,255,0.1)', borderRadius: 20,
                padding: '5px 12px', fontSize: 11, color: 'rgba(255,255,255,0.75)',
              }}>{c}</div>
            ))}
            <div style={{
              background: 'rgba(255,255,255,0.06)', borderRadius: 20,
              padding: '5px 12px', fontSize: 11, color: 'rgba(255,255,255,0.45)',
            }}>+ more</div>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: '20px 20px 100px', maxWidth: 500, margin: '0 auto', width: '100%' }}>
          <div className="card" style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 12, fontWeight: 700 }}>
              Set Up Your Health Profile
            </p>

            {/* Upload */}
            <button
              onClick={() => fileRef.current?.click()}
              style={{
                width: '100%', padding: '14px 16px',
                background: 'var(--green-bg)', border: '1.5px dashed var(--green-light)',
                borderRadius: 'var(--radius-sm)', color: 'var(--green-mid)',
                display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
                cursor: 'pointer', transition: 'all 0.2s', fontFamily: 'inherit',
              }}
            >
              <div style={{
                width: 36, height: 36, background: 'var(--green-mid)', borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0,
              }}>📄</div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Upload Lab Report</div>
                <div style={{ fontSize: 11, color: 'var(--green-dark)', opacity: 0.7 }}>PDF or image — auto-extract vitals</div>
              </div>
              <span style={{ marginLeft: 'auto', color: 'var(--green-light)', fontSize: 20 }}>›</span>
            </button>
            <input ref={fileRef} type="file" accept=".pdf,image/*" style={{ display: 'none' }}
              onChange={e => processFile(e.target.files[0])} />

            {/* Manual */}
            <button onClick={useManual} style={{
              width: '100%', padding: '12px 16px', background: 'transparent',
              border: '1px solid #D0C8BC', borderRadius: 'var(--radius-sm)', color: 'var(--text-mid)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18 }}>✏️</span>
                <span>Enter Conditions Manually</span>
              </div>
              <span style={{ color: '#AAA', fontSize: 18 }}>›</span>
            </button>

            {/* Demo */}
            <button onClick={useDemo} style={{
              width: '100%', padding: '12px 16px',
              background: 'var(--amber-light)', border: '1px solid #F0C870',
              borderRadius: 'var(--radius-sm)', color: '#7A5000',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer', fontFamily: 'inherit', fontSize: 14,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18 }}>🧪</span>
                <span>Load Demo Profile</span>
              </div>
              <span style={{ color: '#C8940A', fontSize: 11, fontWeight: 600 }}>Diabetes + BP</span>
            </button>
          </div>

          {error && (
            <div style={{ padding: '12px 16px', background: 'var(--avoid-bg)', border: '1px solid #FFCDD2', borderRadius: 'var(--radius-sm)', color: 'var(--avoid)', fontSize: 13, marginBottom: 16 }}>
              {error}
            </div>
          )}

          <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
            🔒 Your data stays on your device only.
          </p>
        </div>
      </div>
    );
  }

  // ── Loading step ──────────────────────────────────────────────────────────
  if (step === 'loading') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-4" style={{ background: 'var(--green-bg)' }}>
        <img src="/iris_goldbg.png" alt="IRIS" style={{ width: 64, height: 64, borderRadius: 16, opacity: 0.8 }} />
        <div className="w-14 h-14 spinner" />
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 18, fontWeight: 700, color: 'var(--green-dark)' }}>
            Reading your lab report…
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            IRIS is extracting your health markers
          </p>
        </div>
      </div>
    );
  }

  // ── Vitals preview step (after upload/demo) ──────────────────────────────
  if (step === 'vitals') {
    const chips = buildVitalsChips(editProfile);
    const allVitals = buildAllVitals(editProfile);
    const totalCount = allVitals.filter(r => !r.section).length;

    return (
      <div className="min-h-screen flex flex-col" style={{ background: '#f5f5f5' }}>
        {/* Hero (same as upload) */}
        <div style={{
          background: 'var(--green-light)', padding: '28px 24px 32px',
          textAlign: 'center', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', width: 200, height: 200,
            background: 'rgba(255,255,255,0.10)', borderRadius: '50%',
            top: -60, right: -60,
          }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 6 }}>
            <img src="/iris_white.png" alt="IRIS" style={{ width: 32, height: 32 }} />
            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 28, fontWeight: 700, color: '#fff', letterSpacing: 3 }}>IRIS</span>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 14 }}>
            Intelligent Retail &amp; Ingredient Scanner
          </div>
          <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 22, color: '#fff', lineHeight: 1.3, marginBottom: 16 }}>
            Grocery shopping,<br />built around your health.
          </div>
          <div style={{
            width: 120, height: 90, margin: '0 auto',
            background: 'rgba(255,255,255,0.08)', borderRadius: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 50, border: '1px solid rgba(255,255,255,0.15)',
          }}>🧺</div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: '20px 20px 20px', maxWidth: 500, margin: '0 auto', width: '100%' }}>

          {/* Extracted vitals card */}
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10, fontWeight: 700 }}>
              Extracted Health Vitals
            </div>

            {/* Chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {chips.length > 0 ? chips.map((chip, i) => {
                const s = CHIP_STYLE[chip.level] || CHIP_STYLE.safe;
                return (
                  <div key={i} style={{
                    background: s.bg, padding: '6px 12px', borderRadius: 10,
                    fontSize: 11, color: s.color, fontWeight: 700,
                    border: `1px solid ${s.border}`,
                  }}>
                    {chip.label}
                  </div>
                );
              }) : (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No markers extracted</div>
              )}
            </div>

            {/* See all vitals button */}
            <button
              onClick={() => setShowModal(true)}
              style={{
                width: '100%', padding: '10px', background: 'none', border: 'none',
                color: '#D55A33', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                textAlign: 'center', fontFamily: 'inherit',
              }}
            >
              Tap to see all {totalCount} vitals →
            </button>

            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, paddingTop: 4 }}>
              Report deleted. Only vitals saved.
            </div>
          </div>

          {/* Actions */}
          <button
            onClick={() => setStep('review')}
            className="btn-primary"
            style={{ width: '100%', fontSize: 15, marginBottom: 10 }}
          >
            Review &amp; Edit Profile →
          </button>
          <button
            onClick={handleSave}
            style={{
              width: '100%', padding: '12px', background: 'none',
              border: '1.5px solid var(--green-light)', borderRadius: 'var(--radius-sm)',
              color: 'var(--green-mid)', fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 14,
            }}
          >
            Start Shopping →
          </button>
          <button
            onClick={() => setStep('upload')}
            style={{ width: '100%', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '10px', marginTop: 4 }}
          >
            ← Upload different report
          </button>
        </div>

        {/* All Vitals Modal */}
        {showModal && (
          <div
            onClick={() => setShowModal(false)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 1200, padding: 16,
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                width: '100%', maxWidth: 480, maxHeight: '82vh',
                background: '#fff', borderRadius: 20,
                boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
              }}
            >
              {/* Modal header */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '16px 20px', borderBottom: '1px solid #F0EBE4', flexShrink: 0,
              }}>
                <h3 style={{ fontFamily: 'Inter', fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
                  All {totalCount} vitals
                </h3>
                <button
                  onClick={() => setShowModal(false)}
                  style={{
                    background: 'none', border: 'none', fontSize: 28, lineHeight: 1,
                    cursor: 'pointer', color: '#888', padding: '0 4px',
                  }}
                >×</button>
              </div>

              {/* Modal body — scrollable */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '8px 20px 20px' }}>
                {allVitals.map((row, i) => {
                  if (row.section) {
                    return (
                      <div key={i} style={{
                        fontSize: 11, fontWeight: 800, color: 'var(--text-muted)',
                        textTransform: 'uppercase', letterSpacing: '1px',
                        padding: '14px 0 6px',
                        borderTop: i > 0 ? '1px solid #F0EBE4' : 'none',
                      }}>
                        {row.section}
                      </div>
                    );
                  }
                  return (
                    <div key={i} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '9px 0', borderBottom: '1px solid #F5F0EA', fontSize: 15,
                    }}>
                      <span style={{ color: 'var(--text)', textTransform: row.isCondition ? 'capitalize' : 'none' }}>
                        {row.name}
                      </span>
                      <span style={{ fontWeight: 700, color: 'var(--safe)', flexShrink: 0, marginLeft: 12 }}>
                        {row.value}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Review / Manual entry step ────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: '#f5f5f5' }}>
      {/* Topbar */}
      <div className="iris-topbar">
        <button className="iris-back-btn" onClick={() => setStep(editProfile ? 'vitals' : 'upload')}>‹</button>
        <span className="iris-topbar-title">Health Profile</span>
        {editProfile?.estimated_fields?.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--caution)', fontWeight: 600 }}>* estimated</span>
        )}
      </div>

      <div style={{ maxWidth: 500, margin: '0 auto', padding: '16px 16px 120px' }}>

        {/* Conditions */}
        <div className="card" style={{ marginBottom: 14 }}>
          <h2 style={{ fontFamily: 'Inter', fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
            Select Health Conditions
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            Tap to toggle conditions that apply to you.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {CONDITIONS_LIST.map(({ key, label }) => {
              const active = editProfile?.conditions?.includes(key);
              return (
                <button key={key} onClick={() => toggleCondition(key)} style={{
                  padding: '7px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                  border: active ? '2px solid var(--green-mid)' : '1.5px solid #D0C8BC',
                  background: active ? 'var(--green-mid)' : '#fff',
                  color: active ? '#fff' : 'var(--text-mid)',
                  cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit',
                }}>
                  {active ? '✓ ' : ''}{label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Lab Values */}
        <div className="card" style={{ marginBottom: 14 }}>
          <h2 style={{ fontFamily: 'Inter', fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
            Lab Values
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            Add your latest values for personalized suggestions.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { key: 'fasting_glucose', label: 'Fasting Glucose (mg/dL)', est: editProfile?.estimated_fields?.includes('fasting_glucose') },
              { key: 'hba1c', label: 'HbA1c (%)', est: editProfile?.estimated_fields?.includes('hba1c') },
              { key: 'creatinine', label: 'Creatinine (mg/dL)' },
              { key: 'gfr', label: 'GFR (mL/min)' },
              { key: 'cholesterol_total', label: 'Total Cholesterol (mg/dL)' },
              { key: 'ldl', label: 'LDL (mg/dL)' },
              { key: 'hdl', label: 'HDL (mg/dL)' },
              { key: 'blood_pressure_systolic', label: 'BP Systolic (mmHg)' },
            ].map(({ key, label, est }) => (
              <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                  {label}{est ? ' *' : ''}
                </span>
                <input
                  type="number" step="0.1"
                  className="input-field"
                  style={{ padding: '8px 12px', fontSize: 14 }}
                  value={editProfile?.markers?.[key] ?? ''}
                  placeholder="—"
                  onChange={e => updateMarker(key, e.target.value)}
                />
              </label>
            ))}
          </div>
        </div>

        {/* Daily Limits */}
        <div className="card" style={{ marginBottom: 14 }}>
          <h2 style={{ fontFamily: 'Inter', fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
            Daily Limits
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            Set limits that align with your condition needs.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {[
              { key: 'sodium_daily_mg', label: 'Sodium', unit: 'mg', hint: 'Standard: 2300 | Low: 1500' },
              { key: 'sugar_daily_g', label: 'Sugar', unit: 'g', hint: 'AHA: 25–50' },
              { key: 'potassium_daily_mg', label: 'Potassium', unit: 'mg', hint: 'Standard: 4700 | CKD: 2000' },
              { key: 'protein_daily_g', label: 'Protein', unit: 'g', hint: 'Standard: 50 | CKD: 40' },
              { key: 'calories_daily', label: 'Calories', unit: 'kcal', hint: 'Typical: 1800–2200' },
            ].map(({ key, label, unit, hint }, i, arr) => (
              <div key={key} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 0', borderBottom: i < arr.length - 1 ? '1px solid #F0EBE4' : 'none',
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{hint}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="number"
                    className="input-field"
                    style={{ width: 80, textAlign: 'right', padding: '6px 10px', fontSize: 14 }}
                    value={editProfile?.limits?.[key] ?? ''}
                    onChange={e => updateLimit(key, e.target.value)}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 32, flexShrink: 0 }}>{unit}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <button onClick={handleSave} className="btn-primary" style={{ width: '100%', fontSize: 16, padding: '16px' }}>
          Save Profile &amp; Start Shopping →
        </button>
      </div>
    </div>
  );
}
