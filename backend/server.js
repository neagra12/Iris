require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const fetch = require('node-fetch');
const crypto = require('crypto');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'; // Sarah — warm, natural
const ttsCache = new Map(); // text hash → base64 mp3

const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Health Check ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const k = process.env.ELEVENLABS_API_KEY;
  res.json({
    elevenlabs: k ? `Present (...${k.slice(-4)})` : 'Missing',
    anthropic: process.env.ANTHROPIC_API_KEY ? 'Present' : 'Missing',
    node_version: process.version,
    uptime: process.uptime(),
  });
});

const MODEL = 'claude-sonnet-4-6';
const FAST_MODEL = 'claude-haiku-4-5-20251001'; // for high-frequency voice endpoints

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
}));
app.use(express.json({ limit: '20mb' }));

// Serve React frontend in production
const FRONTEND_DIST = path.join(__dirname, '../frontend/dist');
app.use(express.static(FRONTEND_DIST));

// ── Helpers ────────────────────────────────────────────────────────────────

function parseJSON(text) {
  // 1) direct parse
  try { return JSON.parse(text); } catch {}
  // 2) strip markdown code block
  const md = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (md) { try { return JSON.parse(md[1].trim()); } catch {} }
  // 3) find the LAST (outermost) JSON object — greediest match
  const raw = text.match(/\{[\s\S]*\}/);
  if (raw) { try { return JSON.parse(raw[0]); } catch {} }
  // 4) find JSON array
  const arr = text.match(/\[[\s\S]*\]/);
  if (arr) { try { return JSON.parse(arr[0]); } catch {} }
  console.error('[parseJSON] raw text was:', text.slice(0, 500));
  throw new Error('Could not parse JSON from Claude response');
}

function profileContext(healthProfile) {
  return `The user's health profile: ${JSON.stringify(healthProfile, null, 2)}`;
}

// ── Route 1: Extract health profile from lab report ───────────────────────

app.post('/api/extract-profile', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { buffer, mimetype } = req.file;
    const base64 = buffer.toString('base64');

    const fileBlock = mimetype === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: mimetype, data: base64 } };

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: 'You are a medical data extraction assistant. Extract health markers from lab reports and return valid JSON only. No explanation, no markdown outside the JSON block.',
      messages: [{
        role: 'user',
        content: [
          fileBlock,
          {
            type: 'text',
            text: `Extract all health markers from this lab report. Return ONLY this JSON structure (fill null if not found):
{
  "conditions": [],
  "medications": [],
  "markers": {
    "fasting_glucose": null,
    "hba1c": null,
    "creatinine": null,
    "gfr": null,
    "cholesterol_total": null,
    "ldl": null,
    "hdl": null,
    "blood_sodium": null,
    "blood_potassium": null,
    "blood_pressure_systolic": null,
    "blood_pressure_diastolic": null
  },
  "limits": {
    "sodium_daily_mg": 2300,
    "potassium_daily_mg": 4700,
    "sugar_daily_g": 50,
    "phosphorus_daily_mg": 1000,
    "protein_daily_g": 50,
    "calories_daily": 2000
  },
  "estimated_fields": []
}

Clinical rules for limits:
- If HbA1c >= 6.5% OR fasting glucose >= 126 mg/dL → add "diabetes" to conditions, set sugar_daily_g=25, sodium_daily_mg=1500
- If blood_pressure_systolic >= 130 OR any hypertension noted → add "hypertension" to conditions, set sodium_daily_mg=1500
- If GFR < 60 OR creatinine > 1.2 → add "CKD" to conditions, set potassium_daily_mg=2000, phosphorus_daily_mg=800, protein_daily_g=40
- If LDL > 130 OR total cholesterol > 200 → add "high_cholesterol" to conditions
- Put field names you couldn't read clearly in estimated_fields array
Return ONLY valid JSON.`
          }
        ]
      }]
    });

    const profile = parseJSON(response.content[0].text);
    res.json({ profile });
  } catch (err) {
    console.error('[extract-profile]', err.message);
    res.status(500).json({ error: err.message || 'Failed to extract health profile' });
  }
});

// ── Route 2: Scan grocery product ─────────────────────────────────────────

app.post('/api/scan-product', async (req, res) => {
  try {
    const { imageBase64, healthProfile, mediaType = 'image/jpeg' } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'No image provided' });

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: `You are a health-aware grocery assistant. ${profileContext(healthProfile)}
Keep your spoken responses (agent_reply) extremely brief and conversational (max 1-2 sentences). Do not list out all their health numbers at once.
If an image is blurry or unreadable, say so honestly and provide a helpful fallback.`,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          {
            type: 'text',
            text: `Analyze this grocery product image for this person's health.

Return ONLY this JSON:
{
  "product_name": "Specific product name or best description",
  "verdict": "Safe|Caution|Avoid",
  "reason": "One short sentence citing the most critical number (e.g. 'Contains 890mg sodium — 59% of your daily limit').",
  "agent_reply": "Example: 'This has too much sodium, I'd skip it.' (Keep this conversational and CRITICALLY under 15 words)",
  "confidence": "high|medium|low",
  "confidence_note": "",
  "nutrients": {
    "sodium_mg": null,
    "sugar_g": null,
    "potassium_mg": null,
    "phosphorus_mg": null,
    "protein_g": null,
    "calories": null
  },
  "serving_size": "",
  "alternatives": [
    {"name": "Product name here", "reason": "Why it is a better choice"}
  ]
}

Verdict rules (check against their actual limits):
- Sodium > their sodium_daily_mg limit → Avoid; sodium > 40% of limit → Caution
- Sugar > their sugar_daily_g limit → Avoid; sugar > 40% of limit → Caution
- For CKD patients: potassium > 300mg/serving → Caution; > 500mg → Avoid
- For CKD patients: phosphorus > 150mg/serving → Caution
- Fresh vegetables: generally Safe unless high potassium for CKD
- If blurry/unreadable: set confidence="low", explain in confidence_note, make best guess

If verdict is Caution or Avoid: always include EXACTLY 3 alternatives. Each must have "name" (specific product name) and "reason" fields.
Return ONLY valid JSON.`
          }
        ]
      }]
    });

    console.log('[scan-product] raw response:', response.content[0].text.slice(0, 200));
    const analysis = parseJSON(response.content[0].text);
    res.json({ analysis });
  } catch (err) {
    console.error('[scan-product]', err.message);
    res.status(500).json({ error: err.message || 'Failed to scan product' });
  }
});

// ── Route 3: Cart analysis ─────────────────────────────────────────────────

app.post('/api/cart-analysis', async (req, res) => {
  try {
    const { cart, healthProfile, query: userQuery = "How's my cart looking?" } = req.body;
    if (!cart || cart.length === 0) return res.status(400).json({ error: 'Cart is empty' });

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: `You are a supportive, knowledgeable grocery assistant helping someone shop safely. ${profileContext(healthProfile)}
Be conversational and encouraging — like a caring friend who knows nutrition. Use their actual numbers.`,
      messages: [{
        role: 'user',
        content: `My cart: ${JSON.stringify(cart, null, 2)}

${userQuery}

Return ONLY this JSON:
{
  "summary": "2-3 conversational sentences about how they're doing overall",
  "totals": {
    "sodium_mg": 0,
    "sugar_g": 0,
    "potassium_mg": 0,
    "phosphorus_mg": 0,
    "calories": 0
  },
  "vs_limits": {
    "sodium_pct": 0,
    "sugar_pct": 0,
    "potassium_pct": 0
  },
  "problem_items": [
    {"item": "product name", "issue": "specific issue with numbers", "verdict": "Caution|Avoid"}
  ],
  "remaining_budget": {
    "sodium_mg": 0,
    "sugar_g": 0
  },
  "swap_suggestions": [
    {"swap_out": "current item", "swap_in": "better alternative", "reason": "specific benefit"}
  ],
  "overall_grade": "A|B|C|D|F",
  "encouragement": "Short positive note acknowledging what they did well"
}

Calculate real totals from the cart items' nutrient data. Reference their specific daily limits.
Return ONLY valid JSON.`
      }]
    });

    const result = parseJSON(response.content[0].text);
    res.json({ result });
  } catch (err) {
    console.error('[cart-analysis]', err.message);
    res.status(500).json({ error: err.message || 'Failed to analyze cart' });
  }
});

// ── Route 4: Weekly meal planner ───────────────────────────────────────────

app.post('/api/meal-plan', async (req, res) => {
  try {
    const { budget, preferences, healthProfile } = req.body;
    if (!budget) return res.status(400).json({ error: 'Budget is required' });

    const dietLine = preferences ? `Diet constraints: ${preferences}.` : '';

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 3500,
      system: `You are a health-aware meal planning expert. ${profileContext(healthProfile)}
Every grocery item must be safe for their conditions. Be concise and specific.`,
      messages: [{
        role: 'user',
        content: `Generate a safe week of groceries for $${budget} budget.
${dietLine}
${!preferences && healthProfile ? 'Use their health profile to guide all choices.' : ''}

Return ONLY this JSON (no extra fields):
{
  "total_estimated_cost": 0.00,
  "budget": ${budget},
  "within_budget": true,
  "budget_note": "",
  "sections": {
    "Produce": [{"item": "name", "quantity": "amount", "estimated_cost": 0.00, "flag": ""}],
    "Proteins": [],
    "Grains & Legumes": [],
    "Dairy & Alternatives": [],
    "Pantry & Condiments": []
  },
  "weekly_meal_ideas": ["3 simple meal ideas using these ingredients"],
  "shopping_tips": ["2 actionable tips for their health"],
  "items_to_avoid": ["items to skip and brief reason"],
  "nutritional_recommendations": ["1-2 natural spoken sentences about key nutritional points"]
}

Keep sections to 3-5 items each. Return ONLY valid JSON.`
      }]
    });

    const plan = parseJSON(response.content[0].text);
    res.json({ plan });
  } catch (err) {
    console.error('[meal-plan]', err.message);
    res.status(500).json({ error: err.message || 'Failed to generate meal plan' });
  }
});

// ── Route 5: Secure Image Search Proxy ────────────────────────────────────

app.get('/api/image-search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ imageUrl: null });

  const timedFetch = (url, ms = 3000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }
    }).finally(() => clearTimeout(t));
  };

  // Strategy 1: Open Food Facts (Fast for brands)
  const searchOFF = async (query) => {
    try {
      const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=1`;
      const data = await timedFetch(url, 2000).then(r => r.json());
      const p = data.products?.[0];
      return p ? (p.image_front_url || p.image_url) : null;
    } catch { return null; }
  };

  // Strategy 2: Wikipedia (Perfect for generic foods like "Raw Almonds")
  const searchWiki = async (query) => {
    try {
      // Take first 2 meaningful words for wiki (e.g. "Raw almonds" -> "Almond")
      const words = query.toLowerCase().replace(/[''']s/g, '').split(' ').filter(w => w.length > 3);
      const wikiTerm = words.length > 0 ? words[words.length - 1] : query;
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTerm)}`;
      const data = await timedFetch(url, 1500).then(r => r.json());
      return data?.thumbnail?.source || null;
    } catch { return null; }
  };

  // Strategy 3: Bing Scraper (Last resort for weird queries)
  const searchBing = async (query) => {
    try {
      const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2`;
      const html = await timedFetch(url, 3000).then(r => r.text());
      const match = html.match(/murl&quot;:&quot;(.*?)&quot;/);
      return match?.[1] || null;
    } catch { return null; }
  };

  try {
    // Run all 3 in parallel to be as fast as possible, pick first success
    const results = await Promise.all([searchOFF(q), searchWiki(q), searchBing(q)]);
    const imageUrl = results.find(r => !!r) || null;
    res.json({ imageUrl });
  } catch (err) {
    res.json({ imageUrl: null });
  }
});

// ── Route 6: Conversational Chat Agent ────────────────────────────────────

app.post('/api/chat-product', async (req, res) => {
  try {
    const { message, analysis, healthProfile } = req.body;
    
    // Build a readable alternatives summary for the prompt
    const alts = analysis?.alternatives?.filter(a => a.name || a.product_name || a.swap_in) || [];
    const altSummary = alts.length > 0
      ? alts.map((a, i) => `${i + 1}. ${a.name || a.product_name || a.swap_in}: ${a.reason || ''}`).join('\n')
      : 'None';

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: `You are a conversational Grocery Health Assistant helping a user shop safely.

User's health profile: ${JSON.stringify(healthProfile)}

Current product: ${analysis?.product_name || 'unknown'}
Verdict: ${analysis?.verdict || 'unknown'}
Reason: ${analysis?.reason || ''}
Recommended alternatives:
${altSummary}

Rules:
- Reply in 1-2 natural sentences (under 40 words).
- Speak like a knowledgeable, supportive friend.
- If asked about alternatives, name them and briefly explain why each is better.
- If asked "why", reference the specific health number.
- If verdict is Safe, be encouraging.
- Plain text only — no bullet points, no markdown.`,
      messages: [{ role: 'user', content: message }]
    });

    res.json({ reply: response.content[0].text });
  } catch (err) {
    console.error('[chat-product]', err.message);
    res.status(500).json({ error: 'Failed to chat' });
  }
});

// ── Route 7: Voice Ask (CARECART_COACH_PROMPT style) ──────────────────────

app.post('/api/voice-ask', async (req, res) => {
  try {
    const { question, image, mimeType, healthProfile } = req.body;

    const systemPrompt = `You are a warm, conversational grocery shopping friend helping someone in real-time. You know their health profile.

HEALTH PROFILE: ${JSON.stringify(healthProfile)}

Rules:
- Respond in 2-3 natural spoken sentences MAX. No bullet points. No markdown. Sound like a real person talking.
- Be direct and casual: "Yeah this one's fine" or "Hmm, that sodium is way too high for you"
- Reference their actual health numbers when relevant
- If it's a scan question: give a clear verdict on whether they should buy it
- If conversational: answer naturally like a knowledgeable friend
- No clinical language. Just talk.`;

    let userContent;
    if (image) {
      userContent = [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType || 'image/jpeg',
            data: image,
          },
        },
        { type: 'text', text: question || 'Should I buy this?' },
      ];
    } else {
      userContent = question || '';
    }

    const response = await client.messages.create({
      model: FAST_MODEL,
      max_tokens: 150,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });

    res.json({ reply: response.content[0].text });
  } catch (err) {
    console.error('[voice-ask]', err.message);
    if (err.status === 429) return res.status(429).json({ error: 'Rate limit — try again in a moment.' });
    res.status(500).json({ error: 'Failed to process voice ask' });
  }
});

// ── Route 8: Plan Q&A ─────────────────────────────────────────────────────

app.post('/api/chat-plan', async (req, res) => {
  try {
    const { message, plan, healthProfile } = req.body;

    const sections = Object.entries(plan?.sections || {})
      .map(([s, items]) => `${s}: ${items.map(i => i.item).join(', ')}`)
      .join('\n');

    const recs = (plan?.nutritional_recommendations || []).join(' ');

    const response = await client.messages.create({
      model: FAST_MODEL,
      max_tokens: 200,
      system: `You are a conversational nutrition assistant helping a user understand their weekly grocery plan.

User's health profile: ${JSON.stringify(healthProfile)}
This week's grocery list:
${sections}

Nutritional notes: ${recs}

Rules:
- Reply in 1-3 natural spoken sentences (no bullet points, no markdown).
- Be specific — reference actual items from the list when possible.
- If asked about a nutrient gap, name a specific food from the list that helps, or suggest an easy addition.
- Keep it friendly and encouraging.`,
      messages: [{ role: 'user', content: message }],
    });

    res.json({ reply: response.content[0].text });
  } catch (err) {
    console.error('[chat-plan]', err.message);
    res.status(500).json({ error: 'Failed to chat about plan' });
  }
});

// ── Route: ElevenLabs TTS ──────────────────────────────────────────────────

app.post('/api/tts', async (req, res) => {
  const text = (req.body.text || '').replace(/[*_#`]/g, '').trim();
  if (!text) return res.status(400).json({ error: 'No text' });

  const key = crypto.createHash('md5').update(text).digest('hex');
  if (ttsCache.has(key)) {
    return res.json({ audio: ttsCache.get(key), mime: 'audio/mpeg', cached: true });
  }

  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.45, similarity_boost: 0.80, style: 0.2 },
      }),
    });
    if (!r.ok) {
      const errBody = await r.text().catch(() => '(unreadable)');
      console.error(`[tts] ElevenLabs ${r.status} body:`, errBody);
      throw new Error(`ElevenLabs ${r.status}: ${errBody}`);
    }
    const buf = await r.buffer();
    const b64 = buf.toString('base64');
    if (ttsCache.size > 150) ttsCache.delete(ttsCache.keys().next().value);
    ttsCache.set(key, b64);
    res.json({ audio: b64, mime: 'audio/mpeg' });
  } catch (err) {
    console.error('[tts]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Route: Compare multiple products in a single image ────────────────────

app.post('/api/compare-products', async (req, res) => {
  try {
    const { image, mimeType = 'image/jpeg', question, healthProfile } = req.body;
    if (!image) return res.status(400).json({ error: 'No image provided' });

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: image },
          },
          {
            type: 'text',
            text: `${profileContext(healthProfile)}

The user is holding up multiple products and asking: "${question}"

Look at ALL products visible in the image. Identify each one by name. Then compare them specifically for this user's health conditions and needs.

Reply in 2-4 natural spoken sentences — no bullet points, no markdown. Name the products clearly, state which is better and why, based on the user's health profile. Be direct and conversational.`,
          },
        ],
      }],
    });

    res.json({ reply: response.content[0].text });
  } catch (err) {
    console.error('[compare-products]', err.message);
    res.status(500).json({ error: 'Comparison failed' });
  }
});

// ── Catch-all: serve React app for any non-API route ───────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🥦 Grocery Health API running on http://localhost:${PORT}`));
