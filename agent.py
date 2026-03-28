import os
import json
import base64
import random
import uuid
import asyncio
from typing import Optional

import httpx
import anthropic
import google.genai as genai
from fastapi import FastAPI, File, UploadFile, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.requests import Request
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="CareCart", version="1.0.0")

# Gemini model fallback chain — tries each in order when quota is exceeded
GEMINI_VISION_MODELS = ["gemini-2.5-flash-lite", "gemini-3.1-flash-lite-preview"]
GEMINI_TEXT_MODELS   = ["gemini-2.5-flash-lite", "gemini-3.1-flash-lite-preview", "gemini-3-flash-preview"]

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# In-memory storage
user_profiles = {}   # {user_id: {markers, conditions, allergies, summary}}
user_carts = {}      # {user_id: {items: [...], totals: {...}}}
feedback_log = []    # [{user_id, product, verdict, issue, timestamp}]

# API clients
anthropic_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
gemini_client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

REPORT_EXTRACTION_PROMPT = """You are a medical lab report parser. Extract ALL health markers and lab values from this document.

Return ONLY valid JSON in this exact format:
{
  "markers": {
    "marker_name": {"value": number, "unit": "string", "status": "normal|high|low|critical"},
    ...
  },
  "conditions_detected": ["condition1", "condition2"],
  "medications_mentioned": ["med1", "med2"],
  "summary": "Brief 1-2 sentence summary of key health concerns"
}

Rules:
- Extract EVERY value you can find: blood counts, vitamins, minerals, hormones, liver function, kidney function, thyroid, cholesterol panel, metabolic panel, iron, ferritin, B12, vitamin D, calcium, A1c, creatinine, BUN, eGFR, potassium, sodium, phosphorus, everything.
- Use lowercase_snake_case for marker names (e.g., "hemoglobin_a1c", "ldl_cholesterol", "blood_urea_nitrogen")
- For status: compare against standard reference ranges
- If you detect conditions like diabetes, CKD, hypertension based on the numbers, include them in conditions_detected
- If you cannot read a value clearly, skip it rather than guessing
- Return ONLY the JSON object, no markdown, no backticks, no explanation"""

PRODUCT_ID_PROMPT = """Look at this grocery product image. Identify:
1. Product name and brand (if visible)
2. ALL nutrition facts visible on the label (calories, sodium, sugar, protein, fat, fiber, potassium, phosphorus, carbohydrates, cholesterol, etc.)
3. Ingredients list (if visible)
4. Any allergen warnings
5. Serving size

If this is fresh produce (no label), identify the item (e.g., "banana", "spinach", "salmon fillet").

Return ONLY valid JSON:
{
  "product_name": "string",
  "brand": "string or null",
  "is_packaged": true,
  "nutrition_per_serving": {
    "calories": null,
    "sodium_mg": null,
    "sugar_g": null,
    "protein_g": null,
    "total_fat_g": null,
    "saturated_fat_g": null,
    "cholesterol_mg": null,
    "potassium_mg": null,
    "phosphorus_mg": null,
    "total_carbs_g": null,
    "fiber_g": null
  },
  "serving_size": "string or null",
  "ingredients": "string or null",
  "allergens": [],
  "confidence": "high|medium|low"
}

If you cannot identify the product at all, return:
{"product_name": "unknown", "confidence": "low", "error": "Could not identify product. Please hold it closer or try a different angle."}
"""

SAFETY_EVAL_PROMPT = """You are a health-aware grocery advisor. A user with specific health conditions is asking if they should buy a grocery product.

USER'S HEALTH PROFILE:
{profile_json}

PRODUCT INFORMATION:
{product_json}

USER'S QUESTION: {question}

Evaluate this product against their health profile and respond in ONLY valid JSON:
{{
  "verdict": "SAFE",
  "confidence": "HIGH",
  "reason": "One clear sentence explaining why, referencing their specific numbers.",
  "details": "One additional sentence with context if helpful.",
  "alternatives": [],
  "allergen_alert": false,
  "allergen_message": null,
  "disclaimer_needed": false,
  "nutrient_flags": []
}}

Rules:
- verdict must be "SAFE", "CAUTION", or "AVOID"
- confidence must be "HIGH", "MEDIUM", or "LOW"
- ALWAYS provide exactly 2 alternatives when verdict is CAUTION or AVOID. Each alternative: {{"name": "string", "reason": "string"}}
- Alternatives should be in the SAME product category
- When verdict is SAFE, alternatives array should be empty []
- Reference the user's ACTUAL lab numbers in the reason, not generic advice
- If the user has CKD, flag potassium and phosphorus
- If the user has diabetes/pre-diabetes, flag sugar and total carbs
- If the user has hypertension, flag sodium
- If the user has high cholesterol, flag saturated fat and cholesterol
- Set disclaimer_needed to true if the product touches a severely abnormal marker
- Set allergen_alert to true if product contains any of user's listed allergies
- nutrient_flags format: [{{"nutrient": "string", "amount": number, "unit": "string", "daily_limit": number, "percentage_of_limit": number}}]
- NEVER say this product will "treat" or "cure" any condition
- If no health profile is provided, give general nutritional guidance"""

CART_ANALYSIS_PROMPT = """You are a health-aware grocery advisor. Analyze this user's shopping cart against their health profile.

USER'S HEALTH PROFILE:
{profile_json}

CART CONTENTS:
{cart_json}

NUTRITIONAL TOTALS:
{totals_json}

Provide a cart analysis in ONLY valid JSON:
{{
  "overall_rating": "GOOD",
  "summary": "2-3 sentence overview of how this cart looks for their conditions",
  "top_concerns": [],
  "positives": [],
  "swap_suggestions": []
}}

top_concerns format: [{{"nutrient": "string", "total": number, "daily_limit": number, "percentage": number, "biggest_contributor": "string", "suggestion": "string"}}]
swap_suggestions format: [{{"remove": "string", "replace_with": "string", "benefit": "string"}}]

Rules:
- overall_rating must be "GOOD", "NEEDS_ATTENTION", or "CONCERNING"
- Focus on nutrients that matter for THIS user's conditions
- Be specific about which items are causing problems
- Give actionable swap suggestions they can make right now in the store
- Keep it conversational and encouraging, not clinical
- If the cart looks good, celebrate that"""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def safe_parse_json(text: str):
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    arr_start = text.find("[")
    obj_start = text.find("{")
    if arr_start >= 0 and (obj_start < 0 or arr_start < obj_start):
        text = text[arr_start:text.rfind("]") + 1]
    elif obj_start >= 0:
        text = text[obj_start:text.rfind("}") + 1]
    return json.loads(text)


def recalculate_totals(items: list) -> dict:
    totals = {
        "calories": 0, "sodium_mg": 0, "sugar_g": 0, "protein_g": 0,
        "total_fat_g": 0, "saturated_fat_g": 0, "cholesterol_mg": 0,
        "potassium_mg": 0, "phosphorus_mg": 0, "total_carbs_g": 0, "fiber_g": 0
    }
    for item in items:
        nutrition = item.get("nutrition_per_serving", {}) or {}
        for key in totals:
            val = nutrition.get(key)
            if val is not None:
                totals[key] += val
    return totals


async def lookup_usda(product_name: str) -> dict:
    api_key = os.getenv("USDA_API_KEY", "DEMO_KEY")
    url = "https://api.nal.usda.gov/fdc/v1/foods/search"
    params = {"api_key": api_key, "query": product_name, "dataType": ["Branded"], "pageSize": 3}
    async with httpx.AsyncClient() as http:
        try:
            resp = await http.get(url, params=params, timeout=10)
            data = resp.json()
            if data.get("foods"):
                food = data["foods"][0]
                nutrients = {n.get("nutrientName", ""): n.get("value", 0) for n in food.get("foodNutrients", [])}
                return {"found": True, "product": food.get("description", product_name),
                        "brand": food.get("brandOwner", "Unknown"), "nutrients": nutrients}
        except Exception as e:
            print(f"USDA lookup error: {e}")
    return {"found": False}


async def lookup_off(product_name: str) -> dict:
    """Open Food Facts — 4M+ products, 150 countries (Layer 3)."""
    url = "https://world.openfoodfacts.org/cgi/search.pl"
    params = {"search_terms": product_name, "action": "process", "json": 1, "page_size": 1,
              "fields": "product_name,brands,nutriments,allergens_tags"}
    async with httpx.AsyncClient() as http:
        try:
            resp = await http.get(url, params=params, timeout=8)
            data = resp.json()
            products = data.get("products", [])
            if products:
                p = products[0]
                n = p.get("nutriments", {})
                # OFF stores per 100g; we return as-is and label it
                return {
                    "found": True,
                    "product": p.get("product_name", product_name),
                    "brand": p.get("brands", ""),
                    "per_100g": {
                        "calories":        n.get("energy-kcal_100g"),
                        "sodium_mg":       round(n["sodium_100g"] * 1000, 1) if n.get("sodium_100g") else None,
                        "sugar_g":         n.get("sugars_100g"),
                        "protein_g":       n.get("proteins_100g"),
                        "total_fat_g":     n.get("fat_100g"),
                        "saturated_fat_g": n.get("saturated-fat_100g"),
                        "total_carbs_g":   n.get("carbohydrates_100g"),
                        "fiber_g":         n.get("fiber_100g"),
                        "potassium_mg":    round(n["potassium_100g"] * 1000, 1) if n.get("potassium_100g") else None,
                    },
                    "allergens": p.get("allergens_tags", [])
                }
        except Exception as e:
            print(f"Open Food Facts error: {e}")
    return {"found": False}


async def enrich_with_databases(product_name: str) -> str:
    """Layer 3: fetch USDA + OFF in parallel, return a compact nutrition summary string."""
    if not product_name or product_name.lower() in ("unknown", "nothing_visible", "same_product"):
        return ""
    usda_task = asyncio.create_task(lookup_usda(product_name))
    off_task  = asyncio.create_task(lookup_off(product_name))
    usda, off = await asyncio.gather(usda_task, off_task, return_exceptions=True)

    lines = []
    if isinstance(usda, dict) and usda.get("found"):
        n = usda.get("nutrients", {})
        lines.append(f"USDA data for '{usda.get('product', product_name)}':"
                     f" {n.get('Energy','?')} kcal, Na {n.get('Sodium, Na','?')}mg,"
                     f" Sugar {n.get('Sugars, total including NLEA','?')}g,"
                     f" Protein {n.get('Protein','?')}g per serving.")
    if isinstance(off, dict) and off.get("found"):
        p100 = off.get("per_100g", {})
        lines.append(f"Open Food Facts per 100g: {p100.get('calories','?')} kcal,"
                     f" Na {p100.get('sodium_mg','?')}mg, Sugar {p100.get('sugar_g','?')}g,"
                     f" Protein {p100.get('protein_g','?')}g.")
    return " | ".join(lines)


def merge_usda_nutrition(product_data: dict, usda_data: dict) -> dict:
    if not usda_data.get("found"):
        return product_data
    nutrition = product_data.get("nutrition_per_serving", {}) or {}
    usda_nutrients = usda_data.get("nutrients", {})
    mapping = {
        "Energy": "calories", "Sodium, Na": "sodium_mg", "Sugars, total including NLEA": "sugar_g",
        "Protein": "protein_g", "Total lipid (fat)": "total_fat_g",
        "Fatty acids, total saturated": "saturated_fat_g", "Cholesterol": "cholesterol_mg",
        "Potassium, K": "potassium_mg", "Phosphorus, P": "phosphorus_mg",
        "Carbohydrate, by difference": "total_carbs_g", "Fiber, total dietary": "fiber_g"
    }
    for usda_name, our_key in mapping.items():
        if nutrition.get(our_key) is None and usda_nutrients.get(usda_name) is not None:
            nutrition[our_key] = usda_nutrients[usda_name]
    product_data["nutrition_per_serving"] = nutrition
    return product_data

async def gemini_call(parts: list, system: str = None, max_tokens: int = 250,
                      needs_vision: bool = True) -> str:
    """Gemini with automatic model fallback on quota exhaustion."""
    models = GEMINI_VISION_MODELS if needs_vision else GEMINI_TEXT_MODELS
    last_err = None
    for model in models:
        try:
            cfg = {"max_output_tokens": max_tokens}
            if system:
                cfg["system_instruction"] = system
            r = await gemini_client.aio.models.generate_content(
                model=model,
                contents=[{"role": "user", "parts": parts}],
                config=cfg
            )
            return (r.text or "").strip()
        except Exception as e:
            last_err = e
            err_str = str(e)
            if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "quota" in err_str.lower():
                print(f"Quota on {model}, trying next...")
                continue
            raise  # non-quota error — bail immediately
    raise last_err or RuntimeError("All Gemini models failed")


async def fetch_alternatives_images(alternatives: list) -> list:
    """Enrich alternatives with product images from Open Food Facts."""
    result = []
    async with httpx.AsyncClient(timeout=5) as http:
        for alt in alternatives[:2]:
            name = alt.get("name", "")
            image_url = ""
            try:
                params = {
                    "search_terms": name, "action": "process", "json": 1,
                    "page_size": 1,
                    "fields": "product_name,image_front_small_url,image_front_url,image_url"
                }
                resp = await http.get(
                    "https://world.openfoodfacts.org/cgi/search.pl", params=params
                )
                products = resp.json().get("products", [])
                if products:
                    p = products[0]
                    image_url = (p.get("image_front_small_url")
                                 or p.get("image_front_url")
                                 or p.get("image_url") or "")
            except Exception as e:
                print(f"OFF image fetch error for '{name}': {e}")
            result.append({
                "name": name,
                "reason": alt.get("reason", "Healthier option"),
                "image_url": image_url
            })
    return result



# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
async def health_check():
    return {"status": "ok", "app": "CareCart"}


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


# --- Lab Report ---

@app.post("/api/upload-report")
async def upload_report(file: UploadFile = File(...)):
    content = await file.read()
    b64 = base64.b64encode(content).decode()

    is_pdf = (file.filename or "").lower().endswith(".pdf") or (file.content_type or "") == "application/pdf"
    mime = "application/pdf" if is_pdf else (file.content_type or "image/jpeg")

    # Claude uses "document" type for PDFs, "image" for everything else
    if is_pdf:
        file_block = {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64}}
    else:
        file_block = {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}}

    try:
        response = anthropic_client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2000,
            system="You are a medical lab report parser. Always respond in valid JSON only. No markdown. No explanation outside the JSON.",
            messages=[{
                "role": "user",
                "content": [
                    file_block,
                    {"type": "text", "text": REPORT_EXTRACTION_PROMPT}
                ]
            }]
        )
        profile_data = safe_parse_json(response.content[0].text)
    except Exception as e:
        print(f"Report extraction error: {e}")
        raise HTTPException(status_code=500, detail=f"Could not parse lab report: {str(e)}")

    user_id = uuid.uuid4().hex[:8]
    profile_data["user_id"] = user_id
    profile_data.setdefault("conditions", [])
    profile_data.setdefault("allergies", [])
    # Merge conditions_detected into conditions
    detected = profile_data.pop("conditions_detected", [])
    profile_data["conditions"] = list(set(detected + profile_data["conditions"]))

    # Check for critical markers
    markers = profile_data.get("markers", {})
    critical_markers = [k for k, v in markers.items() if isinstance(v, dict) and v.get("status") == "critical"]
    profile_data["has_critical_markers"] = len(critical_markers) > 0
    profile_data["critical_markers"] = critical_markers

    user_profiles[user_id] = profile_data
    return profile_data


@app.post("/api/profile/{user_id}/conditions")
async def update_conditions(user_id: str, body: dict):
    if user_id not in user_profiles:
        raise HTTPException(status_code=404, detail="Profile not found")
    profile = user_profiles[user_id]
    conditions = body.get("conditions", [])
    allergies = body.get("allergies", [])
    profile["conditions"] = list(set(profile.get("conditions", []) + conditions))
    profile["allergies"] = list(set(profile.get("allergies", []) + allergies))
    user_profiles[user_id] = profile
    return profile


@app.get("/api/profile/{user_id}")
async def get_profile(user_id: str):
    if user_id not in user_profiles:
        raise HTTPException(status_code=404, detail="Profile not found")
    return user_profiles[user_id]


# --- Scanner ---

class ScanRequest(BaseModel):
    image: str
    question: Optional[str] = "Is this product safe for me?"


@app.post("/api/scan/{user_id}")
async def scan_product(user_id: str, body: ScanRequest):
    profile = user_profiles.get(user_id, {})

    # Step 1: Gemini identifies the product
    try:
        gemini_response = await asyncio.to_thread(
            gemini_client.models.generate_content,
            model="gemini-2.5-flash-lite",
            contents=[{
                "role": "user",
                "parts": [
                    {"inline_data": {"data": body.image, "mime_type": "image/jpeg"}},
                    {"text": PRODUCT_ID_PROMPT}
                ]
            }]
        )
        product_data = safe_parse_json(gemini_response.text)
    except Exception as e:
        print(f"Gemini error: {e}")
        raise HTTPException(status_code=500, detail=f"Could not identify product: {str(e)}")

    if product_data.get("product_name") == "unknown" or product_data.get("confidence") == "low":
        return {
            "verdict": "UNKNOWN",
            "confidence": "LOW",
            "reason": product_data.get("error", "I could not read that clearly. Try holding the product closer or at a different angle."),
            "product_name": "Unknown",
            "product_data": product_data
        }

    # Step 2: Supplement with USDA data if needed
    nutrition = product_data.get("nutrition_per_serving", {}) or {}
    missing_count = sum(1 for v in nutrition.values() if v is None)
    if missing_count > 5:
        usda_data = await lookup_usda(product_data.get("product_name", ""))
        product_data = merge_usda_nutrition(product_data, usda_data)

    # Step 3: Claude safety evaluation
    try:
        claude_response = anthropic_client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1500,
            system="You are a health-aware grocery advisor. Always respond in valid JSON only. No markdown. No explanation outside the JSON.",
            messages=[{
                "role": "user",
                "content": SAFETY_EVAL_PROMPT.format(
                    profile_json=json.dumps(profile),
                    product_json=json.dumps(product_data),
                    question=body.question or "Is this product safe for me?"
                )
            }]
        )
        verdict = safe_parse_json(claude_response.content[0].text)
    except Exception as e:
        print(f"Claude error: {e}")
        raise HTTPException(status_code=500, detail=f"Could not evaluate product safety: {str(e)}")

    verdict["product_name"] = product_data.get("product_name", "Unknown")
    verdict["product_data"] = product_data
    return verdict


# --- Scan without profile (guest mode) ---

@app.post("/api/scan")
async def scan_product_guest(body: ScanRequest):
    return await scan_product("guest", body)


# --- Cart ---

class CartAddRequest(BaseModel):
    product_name: str
    nutrition_per_serving: Optional[dict] = None
    serving_size: Optional[str] = None
    brand: Optional[str] = None


@app.post("/api/cart/{user_id}/add")
async def cart_add(user_id: str, body: CartAddRequest):
    if user_id not in user_carts:
        user_carts[user_id] = {"items": [], "totals": {}}
    cart = user_carts[user_id]
    item = {
        "product_name": body.product_name,
        "brand": body.brand,
        "nutrition_per_serving": body.nutrition_per_serving or {},
        "serving_size": body.serving_size
    }
    cart["items"].append(item)
    cart["totals"] = recalculate_totals(cart["items"])
    return cart


@app.get("/api/cart/{user_id}/summary")
async def cart_summary(user_id: str):
    cart = user_carts.get(user_id, {"items": [], "totals": {}})
    profile = user_profiles.get(user_id, {})

    if not cart["items"]:
        return {"overall_rating": "GOOD", "summary": "Your cart is empty. Start scanning products to get started!", "top_concerns": [], "positives": [], "swap_suggestions": []}

    try:
        claude_response = anthropic_client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1500,
            system="You are a health-aware grocery advisor. Always respond in valid JSON only. No markdown. No explanation outside the JSON.",
            messages=[{
                "role": "user",
                "content": CART_ANALYSIS_PROMPT.format(
                    profile_json=json.dumps(profile),
                    cart_json=json.dumps(cart["items"]),
                    totals_json=json.dumps(cart["totals"])
                )
            }]
        )
        analysis = safe_parse_json(claude_response.content[0].text)
    except Exception as e:
        print(f"Cart analysis error: {e}")
        raise HTTPException(status_code=500, detail=f"Could not analyze cart: {str(e)}")

    analysis["items"] = cart["items"]
    analysis["totals"] = cart["totals"]
    return analysis


@app.get("/api/cart/{user_id}")
async def cart_get(user_id: str):
    return user_carts.get(user_id, {"items": [], "totals": {}})


@app.delete("/api/cart/{user_id}/clear")
async def cart_clear(user_id: str):
    user_carts[user_id] = {"items": [], "totals": {}}
    return {"status": "cleared"}


@app.delete("/api/cart/{user_id}/remove/{item_index}")
async def cart_remove_item(user_id: str, item_index: int):
    cart = user_carts.get(user_id, {"items": [], "totals": {}})
    if item_index < 0 or item_index >= len(cart["items"]):
        raise HTTPException(status_code=400, detail="Invalid item index")
    cart["items"].pop(item_index)
    cart["totals"] = recalculate_totals(cart["items"])
    user_carts[user_id] = cart
    return cart


# --- Feedback ---

class FeedbackRequest(BaseModel):
    user_id: Optional[str] = None
    product_name: Optional[str] = None
    reported_verdict: Optional[str] = None
    issue: str
    correct_verdict: Optional[str] = None


@app.post("/api/feedback")
async def submit_feedback(body: FeedbackRequest):
    import datetime
    feedback_log.append({
        "user_id": body.user_id,
        "product_name": body.product_name,
        "reported_verdict": body.reported_verdict,
        "issue": body.issue,
        "correct_verdict": body.correct_verdict,
        "timestamp": datetime.datetime.utcnow().isoformat()
    })
    return {"status": "received", "message": "Thank you for your feedback. It helps us improve."}


# --- Text-to-Speech (ElevenLabs — Rachel voice, warm & natural) ---

import hashlib
import re as _re

ELEVENLABS_API_KEY  = os.getenv("ELEVENLABS_API_KEY")
ELEVENLABS_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"   # Sarah — Mature, Reassuring, Confident (premade, works on free plan)
_tts_cache: dict = {}   # {text_hash: base64_mp3_string}

@app.post("/api/tts")
async def text_to_speech(body: dict):
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="No text provided")

    clean = _re.sub(r'[*_#`]', '', text).strip()
    key = hashlib.md5(clean.encode()).hexdigest()
    if key in _tts_cache:
        return {"audio": _tts_cache[key], "mime": "audio/mpeg", "cached": True}

    try:
        async with httpx.AsyncClient(timeout=20) as http:
            r = await http.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}",
                headers={
                    "xi-api-key": ELEVENLABS_API_KEY,
                    "Content-Type": "application/json",
                },
                json={
                    "text": clean,
                    "model_id": "eleven_turbo_v2_5",
                    "voice_settings": {"stability": 0.45, "similarity_boost": 0.80, "style": 0.2}
                }
            )
        if r.status_code != 200:
            raise RuntimeError(f"ElevenLabs {r.status_code}: {r.text[:200]}")

        mp3_b64 = base64.b64encode(r.content).decode()
        if len(_tts_cache) > 150:
            _tts_cache.pop(next(iter(_tts_cache)))
        _tts_cache[key] = mp3_b64
        return {"audio": mp3_b64, "mime": "audio/mpeg"}

    except Exception as e:
        print(f"TTS error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Real-time coaching (WebSocket + /api/ask)
# ---------------------------------------------------------------------------

CARECART_COACH_PROMPT = """You are CareCart — a highly natural, warm, conversational friend helping someone grocery shop in real-time. You know their health numbers.

USER'S HEALTH PROFILE:
{profile}

You can see what they're holding. Give your honest, perfectly human reaction.

RULES:
- Your VERY FIRST line must be exactly one of: VERDICT:SAFE  VERDICT:CAUTION  VERDICT:AVOID
- Everything after the verdict MUST be a natural, conversational response. Speak exactly like a human talking to a friend on a phone call.
- Feel free to elaborate a bit more freely if necessary. Avoid robotic, formulaic, or repetitive structures.
- Don't use bullet points or dry analytical structures. Chat with them normally.
- Bring in their actual numbers fluidly in conversation when it matters.
- If label isn't readable: "I can't quite see the label, could you hold it a little closer to the camera?"
- If it has one of their allergens: "Oh wait, stop! I noticed this has [allergen]."
- No clinical jargon. Keep it totally natural.
- No health profile? Just give them a normal friendly thought on the item.

VARIED EXAMPLES (notice different openings, tones, structures each time):
VERDICT:AVOID
890mg sodium in one serving — that's brutal for your blood pressure, definitely leave it.

VERDICT:SAFE
Yeah this one's fine. Decent protein, sugar's low, nothing that'll cause problems.

VERDICT:CAUTION
Not the worst but that sugar content's going to push your A1C in the wrong direction. Grab it occasionally, not every week.

VERDICT:SAFE
Honestly a solid pick — the fiber in here is exactly what helps keep blood sugar stable.

VERDICT:AVOID
Way too much saturated fat given your cholesterol numbers. Put it back.

VERDICT:CAUTION
It's borderline — the carbs are manageable but watch your portion size with this one."""

PROACTIVE_SCAN_PROMPT = """You are CareCart — a quick, conversational, friendly shopping buddy watching through someone's camera as they shop.

USER'S HEALTH PROFILE:
{profile}

IF you see a clear grocery product, food item, or fresh produce:
- Respond naturally, exactly as a human friend would speak. Share whether it's good for them in a chatty, conversational tone.
- Do not sound like a generic AI or use rigid formulas. Feel free to use a little humor or warmth.
- Reference a specific number from their profile when relevant.

IF nothing clear is visible (blur, shelf edge, hands, floor):
- Reply exactly: NOTHING_VISIBLE

IF it looks like the same product from before:
- Reply exactly: SAME_PRODUCT"""

VARIATION_HINTS = [
    "be very conversational and human-like", "be warmly encouraging", "be extremely casual", "sound surprised if it's bad",
    "talk like a close friend", "be natural and chatty", "be direct but friendly", "be conversational and relaxed"
]


class AskRequest(BaseModel):
    question: str
    image: Optional[str] = None


@app.post("/api/ask/{user_id}")
async def ask_question(user_id: str, body: AskRequest):
    profile = user_profiles.get(user_id, {})
    profile_text = json.dumps(profile) if profile else "No health profile uploaded — use general nutritional guidelines."
    system_prompt = CARECART_COACH_PROMPT.format(profile=profile_text)

    # Identify product name from image (needed for alternatives)
    product_name = ""
    if body.image:
        try:
            product_name = await asyncio.wait_for(gemini_call(
                parts=[
                    {"inline_data": {"data": body.image, "mime_type": "image/jpeg"}},
                    {"text": "Product name and brand only. E.g. \"Campbell's Chicken Noodle Soup\". If unclear: \"unknown\"."}
                ], max_tokens=30, needs_vision=True
            ), timeout=4.0)
            product_name = product_name.strip('"\'')
        except Exception:
            pass

    parts = []
    if body.image:
        parts.append({"inline_data": {"data": body.image, "mime_type": "image/jpeg"}})
    user_text = f"User asks: {body.question}\n(tone hint: {random.choice(VARIATION_HINTS)})"
    parts.append({"text": user_text})

    try:
        text = await gemini_call(parts=parts, system=system_prompt,
                                 max_tokens=300, needs_vision=bool(body.image))

        # Parse VERDICT (first line) and strip from visible text
        verdict = "SAFE"
        lines = text.split("\n")
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("VERDICT:"):
                verdict = stripped.replace("VERDICT:", "").strip().upper()
                break
        text = "\n".join(l for l in lines if not l.strip().startswith("VERDICT:")).strip()

        # Keyword fallback if VERDICT line was missing/cut off
        if verdict == "SAFE":
            tl = text.lower()
            if any(w in tl for w in ("skip", "avoid", "leave it", "put it back", "don't buy", "too much", "too high")):
                verdict = "CAUTION"

        print(f"[REST] verdict={verdict} product='{product_name}'")

        # Generate alternatives if verdict is CAUTION or AVOID
        alternatives = []
        if verdict in ("CAUTION", "AVOID"):
            try:
                prod_context = f"The product is '{product_name}'." if product_name and product_name.lower() != "unknown" else "The user scanned a grocery product."
                alt_text = await asyncio.wait_for(gemini_call(
                    parts=[{"text": (
                        f"{prod_context} The AI analyzed it and said: '{text}'. "
                        f"Considering this user's health profile: {profile_text}, "
                        f"name exactly 2 safer options than the current item in the same category. "
                        f"Reply ONLY as a JSON array, no extra text: "
                        f'[{{"name":"...", "reason":"one plain sentence why it is safer"}}, ...]'
                    )}],
                    max_tokens=160, needs_vision=False
                ), timeout=5.0)
                alts_raw = safe_parse_json(alt_text) if alt_text else []
                if isinstance(alts_raw, list) and alts_raw:
                    alternatives = await asyncio.wait_for(
                        fetch_alternatives_images(alts_raw), timeout=6.0
                    )
            except Exception as e:
                print(f"REST alternatives error: {e}")

        result = {"response": text}
        if alternatives:
            result["alternatives"] = alternatives
        return result
    except Exception as e:
        print(f"Ask error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    await websocket.accept()

    last_frame = None
    frame_count = 0
    is_proactive_busy = False   # separate lock from question
    is_question_busy  = False
    last_proactive_prefix = ""
    proactive_resume_at = 0.0

    async def do_proactive(image_b64: str):
        nonlocal is_proactive_busy, last_proactive_prefix, proactive_resume_at
        import time
        if is_proactive_busy or not image_b64:
            return
        if time.time() < proactive_resume_at:
            return
        is_proactive_busy = True
        try:
            profile = user_profiles.get(user_id, {})
            profile_text = json.dumps(profile) if profile else "No profile — give general guidance."
            system = PROACTIVE_SCAN_PROMPT.format(profile=profile_text)

            text = await gemini_call(
                parts=[
                    {"inline_data": {"data": image_b64, "mime_type": "image/jpeg"}},
                    {"text": "What grocery product do you see? Give your health verdict or NOTHING_VISIBLE."}
                ],
                system=system, max_tokens=120, needs_vision=True
            )

            if not text or text in ("NOTHING_VISIBLE", "SAME_PRODUCT"):
                return
            prefix = text[:40].lower()
            if prefix == last_proactive_prefix:
                return
            last_proactive_prefix = prefix
            await websocket.send_json({"type": "proactive", "text": text})
            proactive_resume_at = time.time() + 35   # pause scanning for 35s after verdict
        except Exception as e:
            import time
            print(f"Proactive error: {type(e).__name__}: {str(e)[:80]}")
            proactive_resume_at = time.time() + 90
        finally:
            is_proactive_busy = False

    async def do_question(question: str, image_b64: str):
        nonlocal is_question_busy
        if is_question_busy:
            await websocket.send_json({"type": "busy", "text": "Still thinking… one sec!"})
            return
        is_question_busy = True
        try:
            profile = user_profiles.get(user_id, {})
            profile_text = json.dumps(profile) if profile else "No profile — give general guidance."

            # Layer 1: identify product from image (fast)
            product_name = ""
            if image_b64:
                try:
                    product_name = await gemini_call(
                        parts=[
                            {"inline_data": {"data": image_b64, "mime_type": "image/jpeg"}},
                            {"text": "Product name and brand only. E.g. \"Campbell's Chicken Noodle Soup\". If unclear: \"unknown\"."}
                        ], max_tokens=30, needs_vision=True
                    )
                    product_name = product_name.strip('"\'')
                    print(f"Identified: {product_name}")
                except Exception as e:
                    print(f"Product ID error: {e}")

            # Layer 3: USDA + Open Food Facts in parallel
            db_context = ""
            if product_name and product_name.lower() not in ("unknown", ""):
                try:
                    db_context = await asyncio.wait_for(
                        enrich_with_databases(product_name), timeout=3.5
                    )
                except asyncio.TimeoutError:
                    pass

            # Layer 2 + 4: health evaluation with full context
            system = CARECART_COACH_PROMPT.format(profile=profile_text)
            parts = []
            if image_b64:
                parts.append({"inline_data": {"data": image_b64, "mime_type": "image/jpeg"}})
            user_text = f"User asks: {question}\n(tone hint: {random.choice(VARIATION_HINTS)})"
            if db_context:
                user_text += f"\n\nNutrition data from USDA/Open Food Facts:\n{db_context}"
            parts.append({"text": user_text})

            text = await gemini_call(parts=parts, system=system,
                                     max_tokens=150, needs_vision=bool(image_b64))

            # Parse VERDICT line (now always first line) and strip it from visible text
            verdict = "SAFE"
            lines = text.split("\n")
            for line in lines:
                stripped = line.strip()
                if stripped.startswith("VERDICT:"):
                    verdict = stripped.replace("VERDICT:", "").strip().upper()
                    break
            text = "\n".join(l for l in lines if not l.strip().startswith("VERDICT:")).strip()

            # Keyword fallback if VERDICT line was cut off
            if verdict == "SAFE":
                tl = text.lower()
                if any(w in tl for w in ("skip", "avoid", "leave it", "put it back", "don't buy", "too much", "too high")):
                    verdict = "CAUTION"

            print(f"[WS] verdict={verdict} product='{product_name}'")
            is_negative = verdict in ("CAUTION", "AVOID")
            alternatives = []
            if is_negative:
                try:
                    prod_context = f"The product is '{product_name}'." if product_name and product_name.lower() != "unknown" else "The user scanned a grocery product."
                    alt_text = await asyncio.wait_for(gemini_call(
                        parts=[{"text": (
                            f"{prod_context} The AI analyzed it and said: '{text}'. "
                            f"Considering this user's health profile: {profile_text}, "
                            f"name exactly 2 safer options than the current item in the same category. "
                            f"Reply ONLY as a JSON array, no extra text: "
                            f'[{{"name":"...", "reason":"one plain sentence why it is safer"}}, ...]'
                        )}],
                        max_tokens=160, needs_vision=False
                    ), timeout=5.0)
                    alts_raw = safe_parse_json(alt_text) if alt_text else []
                    if isinstance(alts_raw, list) and alts_raw:
                        alternatives = await asyncio.wait_for(
                            fetch_alternatives_images(alts_raw), timeout=6.0
                        )
                except Exception as e:
                    print(f"Alternatives error: {e}")

            payload = {"type": "response", "text": text}
            if alternatives:
                payload["alternatives"] = alternatives
            await websocket.send_json(payload)

        except Exception as e:
            print(f"Question error: {type(e).__name__}: {str(e)[:120]}")
            err_msg = "Connection issue — please try again." if "429" in str(e) else "Couldn't process that. Try again?"
            await websocket.send_json({"type": "response", "text": err_msg})
        finally:
            is_question_busy = False

    try:
        while True:
            data = await websocket.receive_json()
            t = data.get("type")

            if t == "frame":
                last_frame = data.get("image", "")
                frame_count += 1
                if frame_count % 12 == 0:   # every ~18s (12 × 1.5s)
                    asyncio.create_task(do_proactive(last_frame))

            elif t == "question":
                img = data.get("image") or last_frame or ""
                asyncio.create_task(do_question(data.get("question", ""), img))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WS error: {e}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8080, reload=True)