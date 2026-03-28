const BASE = '/api';

async function handleResponse(res) {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function extractProfile(formData) {
  const res = await fetch(`${BASE}/extract-profile`, {
    method: 'POST',
    body: formData,
  });
  return handleResponse(res);
}

export async function scanProduct(imageBase64, healthProfile, mediaType = 'image/jpeg') {
  const res = await fetch(`${BASE}/scan-product`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, healthProfile, mediaType }),
  });
  return handleResponse(res);
}

export async function analyzeCart(cart, healthProfile, query) {
  const res = await fetch(`${BASE}/cart-analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cart, healthProfile, query }),
  });
  return handleResponse(res);
}

export async function generateMealPlan(budget, preferences, healthProfile) {
  const res = await fetch(`${BASE}/meal-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ budget, preferences, healthProfile }),
  });
  return handleResponse(res);
}
