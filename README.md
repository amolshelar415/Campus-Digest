# Campus Digest

Smart Academic Notification Aggregator — Aggregates college emails + Telegram into one prioritized dashboard.

## Quick Start

### 1. Clone & Setup
```bash
git clone https://github.com/YOUR_USERNAME/campus-digest.git
cd campus-digest/backend
cp .env.example .env
# Fill in .env with your credentials
```

### 2. Install dependencies
```bash
pip install -r requirements.txt
python -m spacy download en_core_web_sm
```

### 3. Setup Supabase
- Create project at supabase.com
- Run `supabase/schema.sql` in the SQL Editor

### 4. Train the ML model
```bash
python ml/train.py
```

### 5. Authenticate Telegram (one-time)
```bash
python ingestion/telegram_auth.py
```

### 6. Run the backend locally
```bash
uvicorn main:app --reload --port 8000
```

Open http://localhost:8000/docs to see all API endpoints.

---

## Project Structure
```
campus-digest/
├── backend/           # FastAPI monolith
│   ├── main.py        # Entry point + scheduler
│   ├── api/           # REST API routes
│   ├── core/          # DB, cache, auth, config
│   ├── ingestion/     # Gmail + Telegram fetchers
│   ├── ml/            # Classifier + NLP
│   └── notifications/ # FCM + Telegram bot
├── frontend/          # Next.js 15 (coming Phase 6)
└── supabase/          # Database schema
```

## Tech Stack
- **Backend:** FastAPI + APScheduler (Fly.io free tier)
- **Database:** Supabase PostgreSQL (free tier)
- **Cache:** Upstash Redis (free tier)
- **ML:** scikit-learn TF-IDF + Logistic Regression
- **Notifications:** Firebase FCM + Telegram Bot API
- **Frontend:** Next.js 15 (Vercel free tier)

**Total monthly cost: $0** (for ≤ 10 users)
