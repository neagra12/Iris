import { createContext, useContext, useState, useEffect } from 'react';

const AppContext = createContext(null);

const DEFAULT_PROFILE = {
  conditions: [],
  medications: [],
  markers: {
    fasting_glucose: null,
    hba1c: null,
    creatinine: null,
    gfr: null,
    cholesterol_total: null,
    ldl: null,
    hdl: null,
    blood_sodium: null,
    blood_potassium: null,
    blood_pressure_systolic: null,
    blood_pressure_diastolic: null,
  },
  limits: {
    sodium_daily_mg: 2300,
    potassium_daily_mg: 4700,
    sugar_daily_g: 50,
    phosphorus_daily_mg: 1000,
    protein_daily_g: 50,
    calories_daily: 2000,
  },
  estimated_fields: [],
};

export function AppProvider({ children }) {
  const [healthProfile, setHealthProfile] = useState(() => {
    try {
      const saved = localStorage.getItem('healthProfile');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  const [cart, setCart] = useState(() => {
    try {
      const saved = localStorage.getItem('cart');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  useEffect(() => {
    if (healthProfile) localStorage.setItem('healthProfile', JSON.stringify(healthProfile));
  }, [healthProfile]);

  useEffect(() => {
    localStorage.setItem('cart', JSON.stringify(cart));
  }, [cart]);

  const saveProfile = (profile) => {
    const merged = { ...DEFAULT_PROFILE, ...profile };
    merged.limits = { ...DEFAULT_PROFILE.limits, ...(profile.limits || {}) };
    merged.markers = { ...DEFAULT_PROFILE.markers, ...(profile.markers || {}) };
    setHealthProfile(merged);
  };

  const addToCart = (item) => {
    setCart(prev => [...prev, { ...item, id: Date.now() }]);
  };

  const removeFromCart = (id) => {
    setCart(prev => prev.filter(i => i.id !== id));
  };

  const clearCart = () => setCart([]);

  const resetProfile = () => {
    setHealthProfile(null);
    localStorage.removeItem('healthProfile');
  };

  return (
    <AppContext.Provider value={{
      healthProfile,
      saveProfile,
      resetProfile,
      DEFAULT_PROFILE,
      cart,
      addToCart,
      removeFromCart,
      clearCart,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
