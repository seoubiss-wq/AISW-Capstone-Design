# AI Flask Server

This folder contains a dedicated Flask server for AI retrieval.

Pipeline:

1. SQL filtering from `public.food_general_restaurants_quarter`
2. Parallel retrieval
   - `pgvector` with `intfloat/multilingual-e5-large-instruct`
   - BM25 lexical search
3. Fusion (RRF)
4. Final rerank with `BAAI/bge-reranker-v2-m3`

## 1) Setup

```bash
cd ai_server
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Copy env template:

```bash
copy .env.example .env
```

Set at least one DB env:

- `AI_DATABASE_URL` (recommended)
- or `DEV_DATABASE_URL` / `PROD_DATABASE_URL`

Use the same existing Supabase Postgres project. You do not need a separate Supabase project for this Flask server.

## 2) Enable pgvector Column

Apply the repository migration to your current Supabase database:

- `supabase/migrations/20260410_add_ai_restaurant_search.sql`

If you are not using the Supabase CLI locally yet, run the same SQL in the Supabase SQL Editor or use:

- `ai_server/sql/001_pgvector_setup.sql`

This adds:

- `vector` extension in the `extensions` schema
- `embedding_e5 extensions.vector(1024)` column
- `hnsw` cosine index
- trigger that clears stale embeddings when restaurant text fields change

## 3) Run Server

```bash
python app.py
```

Default server: `http://127.0.0.1:8001`

Gunicorn production start:

```bash
gunicorn -c gunicorn.conf.py app:app
```

This repo also includes:

- `ai_server/gunicorn.conf.py`
- `ai_server/Procfile`

Recommended default for this model-serving app is `1` worker with a few threads, because each Gunicorn worker loads its own embedding and reranker models.
Gunicorn is for Unix/Linux deployment. On local Windows development, keep using `python app.py`.

Windows local WSGI start:

```powershell
waitress-serve --listen=127.0.0.1:8001 app:app
```

## 4) APIs

Health:

```bash
curl http://localhost:8001/health
```

Search:

```bash
curl -X POST http://localhost:8001/ai/search ^
  -H "Content-Type: application/json" ^
  -d "{\"query\":\"강남역 매운 닭갈비\",\"top_k\":10,\"filters\":{\"open_only\":true,\"address_contains\":\"강남\"}}"
```

Index embeddings (admin):

```bash
curl -X POST http://127.0.0.1:8001/ai/admin/embed ^
  -H "Authorization: Bearer <AI_ADMIN_TOKEN>" ^
  -H "Content-Type: application/json" ^
  -d "{\"limit\":5000,\"batch_size\":32,\"open_only\":true}"
```

## Notes

- `EMBEDDING_DEVICE=cuda` works when CUDA is available.
- If `embedding_e5` is missing or empty, vector retrieval is skipped automatically.
- `AI_ADMIN_TOKEN` must be set or `/ai/admin/embed` stays disabled.
- On Linux hosting platforms, set `PORT` from the platform and point your service start command to `gunicorn -c gunicorn.conf.py app:app`.
- You can disable stages with:
  - `ENABLE_VECTOR`
  - `ENABLE_BM25`
  - `ENABLE_RERANKER`
