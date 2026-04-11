from __future__ import annotations

import logging
import os
import re
import hmac
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import torch
import torch.nn.functional as F
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from pgvector.psycopg import register_vector
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from rank_bm25 import BM25Okapi
from transformers import AutoModel, AutoModelForSequenceClassification, AutoTokenizer


logger = logging.getLogger("ai_server")
VECTOR_TYPE_NAME = "extensions.vector"


def parse_bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "y", "on"}:
        return True
    if text in {"0", "false", "no", "n", "off"}:
        return False
    return default


def parse_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, parsed))


def read_bearer_token(value: Any) -> str:
    text = str(value or "").strip()
    scheme, _, token = text.partition(" ")
    if scheme.lower() != "bearer":
        return ""
    return token.strip()


def request_has_admin_token(req: Any, expected_token: str) -> bool:
    admin_token = str(expected_token or "").strip()
    if not admin_token:
        return False

    presented_tokens = [
        read_bearer_token(req.headers.get("Authorization")),
        str(req.headers.get("X-AI-Admin-Token", "")).strip(),
    ]
    return any(
        candidate and hmac.compare_digest(candidate, admin_token)
        for candidate in presented_tokens
    )


def resolve_database_url() -> str:
    explicit = str(os.getenv("AI_DATABASE_URL", "")).strip()
    if explicit:
        return explicit

    is_production = str(os.getenv("NODE_ENV", "")).strip().lower() == "production"
    scoped = "PROD_DATABASE_URL" if is_production else "DEV_DATABASE_URL"
    return str(os.getenv(scoped, "")).strip()


def validate_table_name(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError("AI_TABLE is required.")

    # Keep identifier handling strict because table names cannot be parameterized.
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?", text):
        raise ValueError(f"Invalid table name: {text!r}")

    return text


def split_table_name(value: str) -> Tuple[str, str]:
    text = validate_table_name(value)
    if "." in text:
        return tuple(text.split(".", 1))
    return "public", text


def tokenize_ko_en(text: str) -> List[str]:
    return re.findall(r"[0-9A-Za-z가-힣]+", (text or "").lower())


def build_search_tokens(text: str, maximum: int = 6) -> List[str]:
    seen = set()
    tokens: List[str] = []
    for token in tokenize_ko_en(text):
        if len(token) < 2 or token in seen:
            continue
        seen.add(token)
        tokens.append(token)
        if len(tokens) >= maximum:
            break
    return tokens


def to_pgvector_literal(values: Sequence[float]) -> str:
    return "[" + ",".join(f"{float(x):.8f}" for x in values) + "]"


@dataclass(frozen=True)
class Settings:
    database_url: str
    table_name: str
    host: str
    port: int
    debug: bool
    log_level: str
    admin_token: str
    sql_candidate_limit: int
    vector_top_k: int
    bm25_top_k: int
    rerank_top_k: int
    final_top_k: int
    embedding_model_name: str
    embedding_device: str
    embedding_batch_size: int
    e5_query_instruction: str
    reranker_model_name: str
    enable_vector: bool
    enable_bm25: bool
    enable_reranker: bool

    @classmethod
    def from_env(cls) -> "Settings":
        database_url = resolve_database_url()
        if not database_url:
            raise ValueError("AI_DATABASE_URL (or DEV/PROD_DATABASE_URL) is required.")

        return cls(
            database_url=database_url,
            table_name=validate_table_name(os.getenv("AI_TABLE", "public.food_general_restaurants_quarter")),
            host=str(os.getenv("AI_HOST", "127.0.0.1")).strip() or "127.0.0.1",
            port=parse_int(os.getenv("AI_PORT") or os.getenv("PORT"), default=8001, minimum=1, maximum=65535),
            debug=parse_bool(os.getenv("AI_DEBUG"), default=False),
            log_level=str(os.getenv("AI_LOG_LEVEL", "INFO")).strip().upper() or "INFO",
            admin_token=str(os.getenv("AI_ADMIN_TOKEN", "")).strip(),
            sql_candidate_limit=parse_int(os.getenv("AI_SQL_CANDIDATE_LIMIT"), default=400, minimum=20, maximum=5000),
            vector_top_k=parse_int(os.getenv("AI_VECTOR_TOP_K"), default=120, minimum=1, maximum=1000),
            bm25_top_k=parse_int(os.getenv("AI_BM25_TOP_K"), default=120, minimum=1, maximum=1000),
            rerank_top_k=parse_int(os.getenv("AI_RERANK_TOP_K"), default=40, minimum=1, maximum=300),
            final_top_k=parse_int(os.getenv("AI_FINAL_TOP_K"), default=10, minimum=1, maximum=100),
            embedding_model_name=str(
                os.getenv("EMBEDDING_MODEL_NAME", "intfloat/multilingual-e5-large-instruct")
            ).strip(),
            embedding_device=str(os.getenv("EMBEDDING_DEVICE", "cpu")).strip().lower() or "cpu",
            embedding_batch_size=parse_int(os.getenv("EMBEDDING_BATCH_SIZE"), default=16, minimum=1, maximum=256),
            e5_query_instruction=str(
                os.getenv(
                    "E5_QUERY_INSTRUCTION",
                    "Given a user query, retrieve relevant Korean restaurant candidates.",
                )
            ).strip(),
            reranker_model_name=str(
                os.getenv("RERANKER_MODEL_NAME", "BAAI/bge-reranker-v2-m3")
            ).strip(),
            enable_vector=parse_bool(os.getenv("ENABLE_VECTOR"), default=True),
            enable_bm25=parse_bool(os.getenv("ENABLE_BM25"), default=True),
            enable_reranker=parse_bool(os.getenv("ENABLE_RERANKER"), default=True),
        )


class HybridSearchEngine:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._pool = ConnectionPool(
            conninfo=settings.database_url,
            kwargs={"autocommit": True, "row_factory": dict_row},
            min_size=1,
            max_size=4,
            configure=self._configure_connection,
        )
        self._pool.open(wait=True)

        self._has_vector_column: Optional[bool] = None
        self._embedding_tokenizer = None
        self._embedding_model = None
        self._reranker_tokenizer = None
        self._reranker_model = None
        self._device = self._resolve_torch_device(settings.embedding_device)

    @staticmethod
    def _resolve_torch_device(requested: str) -> torch.device:
        if requested == "cuda" and torch.cuda.is_available():
            return torch.device("cuda")
        return torch.device("cpu")

    @staticmethod
    def _configure_connection(conn) -> None:
        try:
            register_vector(conn)
        except Exception as error:  # pragma: no cover - adapter registration may vary by pgvector version
            logger.debug("pgvector adapter registration skipped: %s", error)

    def _vector_column_exists(self) -> bool:
        if self._has_vector_column is not None:
            return self._has_vector_column

        sql = """
            select exists (
                select 1
                from information_schema.columns
                where table_schema = %s
                  and table_name = %s
                  and column_name = 'embedding_e5'
            ) as ok
        """
        schema_name, table_name = split_table_name(self.settings.table_name)
        with self._pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, (schema_name, table_name))
                row = cur.fetchone() or {}
        self._has_vector_column = bool(row.get("ok"))
        return self._has_vector_column

    def _load_embedding_model(self) -> None:
        if self._embedding_model is not None:
            return

        logger.info("Loading embedding model: %s", self.settings.embedding_model_name)
        self._embedding_tokenizer = AutoTokenizer.from_pretrained(self.settings.embedding_model_name)
        self._embedding_model = AutoModel.from_pretrained(self.settings.embedding_model_name)
        self._embedding_model.to(self._device)
        self._embedding_model.eval()

    def _load_reranker(self) -> None:
        if self._reranker_model is not None:
            return

        logger.info("Loading reranker model: %s", self.settings.reranker_model_name)
        self._reranker_tokenizer = AutoTokenizer.from_pretrained(self.settings.reranker_model_name)
        self._reranker_model = AutoModelForSequenceClassification.from_pretrained(
            self.settings.reranker_model_name
        )
        self._reranker_model.to(self._device)
        self._reranker_model.eval()

    def _encode_texts(self, texts: Sequence[str]) -> List[List[float]]:
        self._load_embedding_model()
        assert self._embedding_tokenizer is not None
        assert self._embedding_model is not None

        outputs: List[List[float]] = []
        batch_size = self.settings.embedding_batch_size

        for start in range(0, len(texts), batch_size):
            batch = list(texts[start : start + batch_size])
            inputs = self._embedding_tokenizer(
                batch,
                max_length=512,
                truncation=True,
                padding=True,
                return_tensors="pt",
            )
            inputs = {name: tensor.to(self._device) for name, tensor in inputs.items()}

            with torch.no_grad():
                model_out = self._embedding_model(**inputs)
                hidden = model_out.last_hidden_state
                mask = inputs["attention_mask"].unsqueeze(-1).float()
                pooled = (hidden * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1e-9)
                normalized = F.normalize(pooled, p=2, dim=1)
            outputs.extend(normalized.cpu().tolist())

        return outputs

    def encode_query(self, query: str) -> List[float]:
        prompt = f"Instruct: {self.settings.e5_query_instruction}\nQuery: {query.strip()}"
        return self._encode_texts([prompt])[0]

    def encode_passages(self, passages: Sequence[str]) -> List[List[float]]:
        prefixed = [f"passage: {text.strip()}" for text in passages]
        return self._encode_texts(prefixed)

    def sql_filter_candidates(
        self, query: str, filters: Dict[str, Any], limit: int
    ) -> List[Dict[str, Any]]:
        conditions = ["1=1"]
        params: List[Any] = []

        open_only = parse_bool(filters.get("open_only"), False)
        if open_only:
            conditions.append(
                "coalesce(business_status_name, '') not ilike %s "
                "and coalesce(detailed_business_status_name, '') not ilike %s"
            )
            params.extend(["%폐업%", "%폐업%"])

        business_type = str(filters.get("business_type", "")).strip()
        if business_type:
            like = f"%{business_type}%"
            conditions.append(
                "(coalesce(business_type_name, '') ilike %s "
                "or coalesce(sanitation_business_type_name, '') ilike %s)"
            )
            params.extend([like, like])

        address_contains = str(filters.get("address_contains", "")).strip()
        if address_contains:
            like = f"%{address_contains}%"
            conditions.append("(coalesce(road_address, '') ilike %s or coalesce(lot_address, '') ilike %s)")
            params.extend([like, like])

        query_tokens = build_search_tokens(query)
        if query_tokens:
            token_conditions: List[str] = []
            for token in query_tokens:
                like = f"%{token}%"
                token_conditions.append(
                    "("
                    "coalesce(business_name, '') ilike %s "
                    "or coalesce(business_type_name, '') ilike %s "
                    "or coalesce(sanitation_business_type_name, '') ilike %s "
                    "or coalesce(road_address, '') ilike %s "
                    "or coalesce(lot_address, '') ilike %s"
                    ")"
                )
                params.extend([like, like, like, like, like])
            conditions.append("(" + " or ".join(token_conditions) + ")")

        sql = f"""
            select
                management_no as id,
                coalesce(business_name, '') as business_name,
                coalesce(business_type_name, '') as business_type_name,
                coalesce(sanitation_business_type_name, '') as sanitation_business_type_name,
                coalesce(road_address, '') as road_address,
                coalesce(lot_address, '') as lot_address,
                coalesce(business_status_name, '') as business_status_name,
                coalesce(detailed_business_status_name, '') as detailed_business_status_name,
                coalesce(phone_number, '') as phone_number,
                coalesce(homepage_url, '') as homepage_url,
                concat_ws(
                    ' ',
                    coalesce(business_name, ''),
                    coalesce(business_type_name, ''),
                    coalesce(sanitation_business_type_name, ''),
                    coalesce(road_address, ''),
                    coalesce(lot_address, ''),
                    coalesce(grade_name, '')
                ) as doc_text
            from {self.settings.table_name}
            where {' and '.join(conditions)}
            order by updated_at desc nulls last
            limit %s
        """
        params.append(limit)

        with self._pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                rows = cur.fetchall() or []

        return list(rows)

    def vector_rank(
        self, candidate_ids: Sequence[str], query_embedding: Sequence[float], top_k: int
    ) -> List[Tuple[str, float]]:
        if not candidate_ids:
            return []
        if not self._vector_column_exists():
            return []

        vector_literal = to_pgvector_literal(query_embedding)
        sql = f"""
            select
                management_no as id,
                (1 - (embedding_e5 <=> %s::{VECTOR_TYPE_NAME}))::float8 as score
            from {self.settings.table_name}
            where management_no = any(%s)
              and embedding_e5 is not null
            order by embedding_e5 <=> %s::{VECTOR_TYPE_NAME}
            limit %s
        """
        params = (vector_literal, list(candidate_ids), vector_literal, top_k)

        with self._pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                rows = cur.fetchall() or []

        return [(row["id"], float(row["score"])) for row in rows if row.get("id")]

    def bm25_rank(
        self, candidates: Sequence[Dict[str, Any]], query: str, top_k: int
    ) -> List[Tuple[str, float]]:
        if not candidates:
            return []

        query_tokens = tokenize_ko_en(query)
        if not query_tokens:
            return []

        tokenized_docs = [tokenize_ko_en(str(item.get("doc_text", ""))) for item in candidates]
        if not any(tokenized_docs):
            return []

        bm25 = BM25Okapi(tokenized_docs)
        scores = bm25.get_scores(query_tokens)

        ranked_indices = sorted(range(len(scores)), key=lambda idx: float(scores[idx]), reverse=True)
        output: List[Tuple[str, float]] = []
        for idx in ranked_indices[:top_k]:
            doc_id = str(candidates[idx].get("id", "")).strip()
            if not doc_id:
                continue
            output.append((doc_id, float(scores[idx])))
        return output

    @staticmethod
    def reciprocal_rank_fusion(rankings: Sequence[Sequence[Tuple[str, float]]], k: int = 60) -> Dict[str, float]:
        fused: Dict[str, float] = {}
        for ranking in rankings:
            for rank, (doc_id, _score) in enumerate(ranking, start=1):
                fused[doc_id] = fused.get(doc_id, 0.0) + 1.0 / (k + rank)
        return fused

    def rerank(
        self, query: str, candidates: Sequence[Dict[str, Any]], top_k: int
    ) -> List[Tuple[str, float]]:
        if not candidates:
            return []

        self._load_reranker()
        assert self._reranker_tokenizer is not None
        assert self._reranker_model is not None

        query_texts = [query] * len(candidates)
        doc_texts = [str(item.get("doc_text", "")) for item in candidates]
        inputs = self._reranker_tokenizer(
            query_texts,
            doc_texts,
            max_length=512,
            truncation=True,
            padding=True,
            return_tensors="pt",
        )
        inputs = {name: tensor.to(self._device) for name, tensor in inputs.items()}

        with torch.no_grad():
            logits = self._reranker_model(**inputs).logits.view(-1).float().cpu().tolist()

        scored: List[Tuple[str, float]] = []
        for row, score in zip(candidates, logits):
            doc_id = str(row.get("id", "")).strip()
            if doc_id:
                scored.append((doc_id, float(score)))

        scored.sort(key=lambda item: item[1], reverse=True)
        return scored[:top_k]

    def search(self, query: str, filters: Dict[str, Any], top_k: int) -> Dict[str, Any]:
        candidates = self.sql_filter_candidates(
            query=query,
            filters=filters,
            limit=self.settings.sql_candidate_limit,
        )
        if not candidates:
            return {
                "query": query,
                "count": 0,
                "items": [],
                "meta": {"sql_candidates": 0, "vector_used": False, "reranker_used": False},
            }

        candidate_by_id = {str(row["id"]): row for row in candidates if row.get("id")}
        candidate_ids = list(candidate_by_id.keys())

        vector_ranking: List[Tuple[str, float]] = []
        bm25_ranking: List[Tuple[str, float]] = []
        query_embedding: Optional[List[float]] = None

        use_vector = self.settings.enable_vector and self._vector_column_exists()
        use_bm25 = self.settings.enable_bm25

        if use_vector and query.strip():
            query_embedding = self.encode_query(query)

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = {}
            if query_embedding is not None:
                futures["vector"] = executor.submit(
                    self.vector_rank, candidate_ids, query_embedding, self.settings.vector_top_k
                )
            if use_bm25:
                futures["bm25"] = executor.submit(
                    self.bm25_rank, candidates, query, self.settings.bm25_top_k
                )
            for name, future in futures.items():
                result = future.result()
                if name == "vector":
                    vector_ranking = result
                elif name == "bm25":
                    bm25_ranking = result

        if not vector_ranking and not bm25_ranking:
            # Final fallback when query is empty or tokenization fails.
            fused_ids = candidate_ids[: self.settings.rerank_top_k]
            fused_scores = {doc_id: 0.0 for doc_id in fused_ids}
        else:
            fused_scores = self.reciprocal_rank_fusion([vector_ranking, bm25_ranking], k=60)
            fused_ids = [doc_id for doc_id, _ in sorted(fused_scores.items(), key=lambda item: item[1], reverse=True)]
            fused_ids = fused_ids[: self.settings.rerank_top_k]

        fused_candidates = [candidate_by_id[doc_id] for doc_id in fused_ids if doc_id in candidate_by_id]
        vector_score_map = dict(vector_ranking)
        bm25_score_map = dict(bm25_ranking)

        if self.settings.enable_reranker and query.strip() and fused_candidates:
            rerank_ranking = self.rerank(query, fused_candidates, top_k=max(top_k, self.settings.final_top_k))
        else:
            rerank_ranking = [(doc_id, fused_scores.get(doc_id, 0.0)) for doc_id in fused_ids]

        rerank_score_map = dict(rerank_ranking)
        final_ids = [doc_id for doc_id, _ in rerank_ranking][:top_k]
        final_items: List[Dict[str, Any]] = []
        for doc_id in final_ids:
            row = candidate_by_id.get(doc_id)
            if not row:
                continue

            address = row.get("road_address") or row.get("lot_address") or ""
            status = row.get("detailed_business_status_name") or row.get("business_status_name") or ""
            business_type = row.get("business_type_name") or row.get("sanitation_business_type_name") or ""

            final_items.append(
                {
                    "id": doc_id,
                    "name": row.get("business_name") or "",
                    "business_type": business_type,
                    "address": address,
                    "status": status,
                    "phone_number": row.get("phone_number") or "",
                    "homepage_url": row.get("homepage_url") or "",
                    "scores": {
                        "rrf": fused_scores.get(doc_id, 0.0),
                        "vector": vector_score_map.get(doc_id),
                        "bm25": bm25_score_map.get(doc_id),
                        "rerank": rerank_score_map.get(doc_id),
                    },
                }
            )

        return {
            "query": query,
            "count": len(final_items),
            "items": final_items,
            "meta": {
                "sql_candidates": len(candidates),
                "vector_used": bool(vector_ranking),
                "bm25_used": bool(bm25_ranking),
                "reranker_used": self.settings.enable_reranker and bool(query.strip()),
            },
        }

    def index_embeddings(self, limit: int, batch_size: int, open_only: bool) -> Dict[str, Any]:
        if not self._vector_column_exists():
            raise RuntimeError(
                "embedding_e5 column is missing. Run supabase/migrations/20260410_add_ai_restaurant_search.sql "
                "or ai_server/sql/001_pgvector_setup.sql first."
            )

        conditions = ["embedding_e5 is null"]
        params: List[Any] = []
        if open_only:
            conditions.append(
                "coalesce(business_status_name, '') not ilike %s "
                "and coalesce(detailed_business_status_name, '') not ilike %s"
            )
            params.extend(["%폐업%", "%폐업%"])

        sql_select = f"""
            select
                management_no as id,
                concat_ws(
                    ' ',
                    coalesce(business_name, ''),
                    coalesce(business_type_name, ''),
                    coalesce(sanitation_business_type_name, ''),
                    coalesce(road_address, ''),
                    coalesce(lot_address, ''),
                    coalesce(grade_name, '')
                ) as doc_text
            from {self.settings.table_name}
            where {' and '.join(conditions)}
            limit %s
        """
        params.append(limit)

        with self._pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql_select, params)
                rows = cur.fetchall() or []

                total = len(rows)
                if total == 0:
                    return {"selected": 0, "embedded": 0}

                embedded = 0
                sql_update = (
                    f"update {self.settings.table_name} "
                    f"set embedding_e5 = %s::{VECTOR_TYPE_NAME} "
                    f"where management_no = %s"
                )

                for start in range(0, total, batch_size):
                    batch = rows[start : start + batch_size]
                    docs = [str(item.get("doc_text", "")) for item in batch]
                    vectors = self.encode_passages(docs)
                    update_params = [
                        (to_pgvector_literal(vec), str(item.get("id", "")))
                        for item, vec in zip(batch, vectors)
                        if item.get("id")
                    ]
                    cur.executemany(sql_update, update_params)
                    embedded += len(update_params)

        return {"selected": total, "embedded": embedded}

    def health(self) -> Dict[str, Any]:
        with self._pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("select 1 as ok")
                row = cur.fetchone() or {}

        return {
            "ok": bool(row.get("ok") == 1),
            "table": self.settings.table_name,
            "vector_column": self._vector_column_exists(),
            "device": str(self._device),
        }


def create_app() -> Flask:
    load_dotenv()
    settings = Settings.from_env()
    logging.basicConfig(
        level=getattr(logging, settings.log_level, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    engine = HybridSearchEngine(settings)

    app = Flask(__name__)

    @app.get("/health")
    def health() -> Any:
        return jsonify(engine.health())

    @app.post("/ai/search")
    def ai_search() -> Any:
        payload = request.get_json(silent=True) or {}
        query = str(payload.get("query", "")).strip()
        if not query:
            return jsonify({"error": "query is required"}), 400

        filters = payload.get("filters")
        if not isinstance(filters, dict):
            filters = {}

        top_k = parse_int(payload.get("top_k"), default=settings.final_top_k, minimum=1, maximum=100)
        result = engine.search(query=query, filters=filters, top_k=top_k)
        return jsonify(result)

    @app.post("/ai/admin/embed")
    def ai_admin_embed() -> Any:
        if not settings.admin_token:
            return jsonify({"error": "not found"}), 404
        if not request_has_admin_token(request, settings.admin_token):
            return jsonify({"error": "admin authorization required"}), 403

        payload = request.get_json(silent=True) or {}
        limit = parse_int(payload.get("limit"), default=1000, minimum=1, maximum=200000)
        batch_size = parse_int(payload.get("batch_size"), default=settings.embedding_batch_size, minimum=1, maximum=512)
        open_only = parse_bool(payload.get("open_only"), default=False)
        result = engine.index_embeddings(limit=limit, batch_size=batch_size, open_only=open_only)
        return jsonify(result)

    @app.errorhandler(Exception)
    def handle_error(error: Exception):  # type: ignore[override]
        logger.exception("Unhandled exception: %s", error)
        return jsonify({"error": str(error)}), 500

    return app


app = create_app()


if __name__ == "__main__":
    env_settings = Settings.from_env()
    app.run(host=env_settings.host, port=env_settings.port, debug=env_settings.debug)
