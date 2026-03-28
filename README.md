# Smart Grocery Health Assistant

An AI-powered grocery scanning app that checks products against your personal health profile using Claude.

## Quick Start

### 1. Set up backend
```bash
cd backend
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
npm install
npm start
```

### 2. Set up frontend (new terminal)
```bash
cd frontend
npm install
npm run dev
```

### 3. Open app
Visit http://localhost:5173

## Features

| Feature | Description |
|---------|-------------|
| 🔬 Lab Report Upload | Upload PDF or image → Claude extracts health markers |
| 📷 Product Scanner | Live camera → AI verdict: Safe / Caution / Avoid |
| 🔊 Voice Verdicts | Web Speech API reads every verdict aloud |
| 💡 Alternatives | Auto-suggested safer swaps for Caution/Avoid items |
| 🛒 Cart Analyzer | Running totals + "How's my cart?" AI summary |
| 📋 Meal Planner | Weekly grocery list within budget, pre-vetted for your conditions |

## Demo Flow

1. Launch app → Click **"Load Demo"** (pre-fills diabetic + hypertension profile)
2. Tap **Scan** tab → point at any food product → tap **Scan Product**
3. Hear the verdict spoken aloud, see alternatives if needed
4. Tap **Add to Cart** → scan 3-4 more items
5. Tap **Cart** tab → tap **How's My Cart?**
6. Tap **Planner** tab → enter $70 → tap **Generate My List**

## Architecture

```
frontend (Vite + React + Tailwind)  →  /api proxy  →  backend (Express)  →  Claude API
                                                                              claude-sonnet-4-5
```

## API Keys

Add your Anthropic API key to `backend/.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
```
