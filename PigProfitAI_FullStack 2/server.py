"""PigProfit AI multi-tenant application server.

This is a small, auditable SaaS MVP backend. It stores each workspace snapshot in
SQLite with optimistic revision control and enforces workspace isolation through
server-side session lookup. For a larger production deployment, migrate snapshot
storage to normalized PostgreSQL tables and a managed object store.
"""
from __future__ import annotations

import hashlib
import hmac
import io
import logging
import smtplib
import ssl
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
import threading
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from urllib.parse import quote
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("PIGPROFIT_DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = Path(os.environ.get("PIGPROFIT_DB_PATH", DATA_DIR / "pigprofit.sqlite3"))
SESSION_DAYS = int(os.environ.get("PIGPROFIT_SESSION_DAYS", "30"))
MAX_SNAPSHOT_BYTES = int(os.environ.get("PIGPROFIT_MAX_SNAPSHOT_BYTES", str(15 * 1024 * 1024)))
PASSWORD_ITERATIONS = 310_000
AUTH_RATE_WINDOW_SECONDS = 15 * 60
AUTH_MAX_FAILED_LOGINS = 8
AUTH_MAX_REGISTRATIONS_PER_WINDOW = 12
PASSWORD_RESET_TOKEN_MINUTES = 30
PASSWORD_RESET_MAX_PER_IP = 8
PASSWORD_RESET_MAX_PER_EMAIL = 4
logger = logging.getLogger("pigprofit.auth")
_AUTH_ATTEMPTS: dict[str, list[float]] = {}
_AUTH_ATTEMPTS_LOCK = threading.Lock()
_AUTH_SWEEP_COUNT = 0

@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="PigProfit AI API", version="1.8.0", docs_url=None, redoc_url=None, lifespan=lifespan)


def _rate_key(request: Request, purpose: str, email: str = "") -> str:
    client_host = request.client.host if request.client else "unknown"
    return f"{purpose}:{client_host}:{email.lower()}"


def _check_rate_limit(key: str, maximum: int, message: str) -> None:
    global _AUTH_SWEEP_COUNT
    now = time.monotonic()
    with _AUTH_ATTEMPTS_LOCK:
        _AUTH_SWEEP_COUNT += 1
        if _AUTH_SWEEP_COUNT % 128 == 0:
            # Bound memory growth if an attacker submits many distinct email values.
            stale = [k for k, values in _AUTH_ATTEMPTS.items() if not any(now - ts < AUTH_RATE_WINDOW_SECONDS for ts in values)]
            for stale_key in stale:
                _AUTH_ATTEMPTS.pop(stale_key, None)
        attempts = [ts for ts in _AUTH_ATTEMPTS.get(key, []) if now - ts < AUTH_RATE_WINDOW_SECONDS]
        _AUTH_ATTEMPTS[key] = attempts
        if len(attempts) >= maximum:
            raise HTTPException(429, message, headers={"Retry-After": str(AUTH_RATE_WINDOW_SECONDS)})


def _record_rate_attempt(key: str) -> None:
    now = time.monotonic()
    with _AUTH_ATTEMPTS_LOCK:
        attempts = [ts for ts in _AUTH_ATTEMPTS.get(key, []) if now - ts < AUTH_RATE_WINDOW_SECONDS]
        attempts.append(now)
        _AUTH_ATTEMPTS[key] = attempts


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None = None) -> str:
    return (dt or utcnow()).isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA busy_timeout = 15000")
    return con


@contextmanager
def db_session():
    con = connect()
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def init_db() -> None:
    with db_session() as con:
        con.execute("PRAGMA journal_mode = WAL")
        con.executescript("""
        CREATE TABLE IF NOT EXISTS tenants (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            plan TEXT NOT NULL DEFAULT 'trial',
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            email TEXT NOT NULL,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('owner','manager','editor','viewer')),
            farm_scope TEXT NOT NULL DEFAULT '["*"]',
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            UNIQUE(email)
        );
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
        CREATE TABLE IF NOT EXISTS snapshots (
            tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
            revision INTEGER NOT NULL DEFAULT 0,
            payload TEXT NOT NULL,
            updated_by TEXT,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            user_id TEXT,
            action TEXT NOT NULL,
            detail TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            token_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL,
            used_at TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id, created_at);
        CREATE TABLE IF NOT EXISTS billing_requests (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            requested_plan TEXT NOT NULL CHECK(requested_plan IN ('starter','professional','enterprise')),
            billing_cycle TEXT NOT NULL CHECK(billing_cycle IN ('monthly','annual')),
            contact_phone TEXT NOT NULL DEFAULT '',
            message TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
            created_at TEXT NOT NULL,
            resolved_at TEXT,
            resolved_by TEXT,
            admin_note TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_billing_requests_tenant ON billing_requests(tenant_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_billing_requests_status ON billing_requests(status, created_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_billing_request_per_tenant
            ON billing_requests(tenant_id) WHERE status='pending';
        """)
        # Backward-compatible schema migration for existing pilot databases.
        user_columns = {row["name"] for row in con.execute("PRAGMA table_info(users)").fetchall()}
        if "farm_scope" not in user_columns:
            con.execute("ALTER TABLE users ADD COLUMN farm_scope TEXT NOT NULL DEFAULT '[\"*\"]'")
        tenant_columns = {row["name"] for row in con.execute("PRAGMA table_info(tenants)").fetchall()}
        if "subscription_ends_at" not in tenant_columns:
            con.execute("ALTER TABLE tenants ADD COLUMN subscription_ends_at TEXT")
        # Enforce email uniqueness across workspaces for fresh databases and safely
        # strengthen older pilot databases when they do not contain legacy duplicates.
        duplicates = con.execute("SELECT lower(email) e FROM users GROUP BY lower(email) HAVING COUNT(*) > 1 LIMIT 1").fetchone()
        if not duplicates:
            con.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_nocase_unique ON users(lower(email))")


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(self), microphone=(), geolocation=()")
    response.headers.setdefault("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
    response.headers.setdefault("Cache-Control", "no-store" if request.url.path.startswith("/api/") else "no-cache")
    return response


def blank_snapshot(farm_name: str) -> dict[str, Any]:
    now = iso()
    return {
        "version": 4,
        "settings": {"farmName": farm_name or "Trang trại của tôi", "farms": []},
        "batches": [], "feedTypes": [], "logs": [], "weighings": [], "costs": [],
        "sales": [], "pigs": [], "createdAt": now, "updatedAt": now,
    }


def validate_snapshot(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise HTTPException(422, "Dữ liệu sao lưu phải là một đối tượng JSON.")
    required_arrays = ("batches", "logs", "weighings", "costs")
    for key in required_arrays:
        if not isinstance(payload.get(key), list):
            raise HTTPException(422, f"Thiếu danh sách {key} hoặc dữ liệu không hợp lệ.")
    if not isinstance(payload.get("settings", {}), dict):
        raise HTTPException(422, "Cấu hình trang trại không hợp lệ.")
    for key in ("feedTypes", "sales", "pigs"):
        if key in payload and not isinstance(payload[key], list):
            raise HTTPException(422, f"Danh sách {key} không hợp lệ.")
    # Prevent accidental snapshots from storing huge binary/data URI blobs.
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > MAX_SNAPSHOT_BYTES:
        raise HTTPException(413, "Dữ liệu vượt quá giới hạn cho phép. Hãy xuất tệp đính kèm riêng hoặc giảm dung lượng sao lưu.")
    clean = dict(payload)
    clean["version"] = 4
    clean["feedTypes"] = clean.get("feedTypes", [])
    clean["sales"] = clean.get("sales", [])
    clean["pigs"] = clean.get("pigs", [])
    clean["settings"] = dict(clean.get("settings", {}))
    clean["updatedAt"] = iso()
    return clean


def password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${salt.hex()}${digest.hex()}"


def password_verify(password: str, stored: str) -> bool:
    try:
        scheme, rounds, salt_hex, digest_hex = stored.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(rounds)).hex()
        return hmac.compare_digest(actual, digest_hex)
    except (ValueError, TypeError):
        return False


def new_session(con: sqlite3.Connection, user_id: str) -> tuple[str, str]:
    token = secrets.token_urlsafe(42)
    expiry = utcnow() + timedelta(days=SESSION_DAYS)
    con.execute("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
                (hashlib.sha256(token.encode()).hexdigest(), user_id, iso(expiry), iso()))
    return token, iso(expiry)


def _parse_farm_scope(raw: str | None) -> list[str]:
    try:
        scope = json.loads(raw or '["*"]')
    except (TypeError, json.JSONDecodeError):
        scope = ["*"]
    if not isinstance(scope, list) or "*" in scope:
        return ["*"]
    return [str(x) for x in scope if isinstance(x, str) and x]


def public_user(row: sqlite3.Row) -> dict[str, Any]:
    scope = _parse_farm_scope(row["farm_scope"] if "farm_scope" in row.keys() else None)
    all_farms = "*" in scope
    return {"id": row["id"], "tenantId": row["tenant_id"], "email": row["email"], "name": row["name"], "role": row["role"], "allFarms": all_farms, "farmIds": None if all_farms else scope}


def _snapshot_has_data(data: dict[str, Any]) -> bool:
    return any(len(data.get(k, [])) for k in ("batches", "logs", "weighings", "costs", "sales", "pigs")) or bool(data.get("settings", {}).get("farms"))


def _scope_snapshot(data: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    if current.get("allFarms", True):
        return data
    allowed = set(current.get("farmIds") or [])
    view = json.loads(json.dumps(data, ensure_ascii=False))
    settings = view.setdefault("settings", {})
    settings["farms"] = [f for f in settings.get("farms", []) if str(f.get("id", "")) in allowed]
    if settings["farms"]:
        settings["farmName"] = settings["farms"][0].get("name", "Trang trại được phân quyền")
    visible_batch_ids = {str(b.get("id", "")) for b in view.get("batches", []) if str(b.get("farmId", "")) in allowed}
    view["batches"] = [b for b in view.get("batches", []) if str(b.get("farmId", "")) in allowed]
    for key in ("logs", "weighings", "costs", "sales", "pigs"):
        view[key] = [item for item in view.get(key, []) if str(item.get("batchId", "")) in visible_batch_ids]
    return view


def _merge_scoped_snapshot(existing: dict[str, Any], incoming: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    """Merge an assigned user's view into the workspace without touching other farms."""
    allowed = set(current.get("farmIds") or [])
    existing = json.loads(json.dumps(existing, ensure_ascii=False))
    incoming = json.loads(json.dumps(incoming, ensure_ascii=False))
    if incoming.get("feedTypes", []) != existing.get("feedTypes", []):
        raise HTTPException(403, "Danh mục cám dùng chung toàn workspace; chỉ tài khoản có quyền toàn trại mới được thay đổi.")

    old_farms = existing.get("settings", {}).get("farms", [])
    new_farms = incoming.get("settings", {}).get("farms", [])
    old_farm_ids = {str(f.get("id", "")) for f in old_farms}
    new_farm_ids = {str(f.get("id", "")) for f in new_farms}
    if not new_farm_ids.issubset(allowed):
        raise HTTPException(403, "Dữ liệu có trang trại nằm ngoài phạm vi được cấp quyền.")
    required_visible_farms = old_farm_ids & allowed
    if not required_visible_farms.issubset(new_farm_ids):
        raise HTTPException(422, "Không thể xóa trang trại được phân quyền khỏi snapshot.")

    old_batches = existing.get("batches", [])
    old_scoped_batch_ids = {str(b.get("id", "")) for b in old_batches if str(b.get("farmId", "")) in allowed}
    old_unscoped_batch_ids = {str(b.get("id", "")) for b in old_batches if str(b.get("farmId", "")) not in allowed}
    new_batches = incoming.get("batches", [])
    new_batch_ids = {str(b.get("id", "")) for b in new_batches}
    for b in new_batches:
        bid, fid = str(b.get("id", "")), str(b.get("farmId", ""))
        if fid not in allowed:
            raise HTTPException(403, "Lứa nuôi nằm ngoài phạm vi được cấp quyền.")
        if bid in old_unscoped_batch_ids:
            raise HTTPException(403, "Không thể thay đổi dữ liệu lứa nuôi thuộc trang trại khác.")
    for key in ("logs", "weighings", "costs", "sales", "pigs"):
        for item in incoming.get(key, []):
            if str(item.get("batchId", "")) not in new_batch_ids:
                raise HTTPException(422, f"Bản ghi {key} phải thuộc một lứa nuôi trong phạm vi được cấp quyền.")

    merged = existing
    # Keep workspace-level settings intact except for the assigned farm metadata.
    merged_settings = dict(existing.get("settings", {}))
    unscoped_farms = [f for f in old_farms if str(f.get("id", "")) not in allowed]
    merged_settings["farms"] = unscoped_farms + new_farms
    merged["settings"] = merged_settings
    merged["batches"] = [b for b in old_batches if str(b.get("farmId", "")) not in allowed] + new_batches
    for key in ("logs", "weighings", "costs", "sales", "pigs"):
        previous = existing.get(key, [])
        preserve = [item for item in previous if str(item.get("batchId", "")) not in old_scoped_batch_ids]
        merged[key] = preserve + incoming.get(key, [])
    merged["version"] = incoming.get("version", 4)
    merged["updatedAt"] = incoming.get("updatedAt") or iso()
    return merged


def get_current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Bạn cần đăng nhập để tiếp tục.")
    token = authorization.split(" ", 1)[1].strip()
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with db_session() as con:
        row = con.execute("""SELECT u.*, t.name AS tenant_name, t.status AS tenant_status, t.plan AS tenant_plan,
                                  s.expires_at AS session_expiry
                           FROM sessions s JOIN users u ON u.id=s.user_id
                           JOIN tenants t ON t.id=u.tenant_id WHERE s.token_hash=?""", (token_hash,)).fetchone()
        if not row:
            raise HTTPException(401, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.")
        if row["session_expiry"] <= iso():
            con.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))
            raise HTTPException(401, "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")
        if not row["is_active"]:
            raise HTTPException(403, "Tài khoản đã bị khóa. Hãy liên hệ quản trị viên workspace.")
        if row["tenant_status"] != "active":
            raise HTTPException(403, "Workspace đã bị tạm khóa.")
        result = public_user(row)
        result.update({"tenantName": row["tenant_name"], "plan": row["tenant_plan"], "sessionExpiry": row["session_expiry"]})
        return result


class RegisterBody(BaseModel):
    tenantName: str = Field(min_length=2, max_length=120)
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=10, max_length=200)
    initialData: dict[str, Any] | None = None


class LoginBody(BaseModel):
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=1, max_length=200)


class SnapshotBody(BaseModel):
    data: dict[str, Any]
    expectedRevision: int = Field(ge=0)


class MemberBody(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=10, max_length=200)
    role: str = "editor"
    farmIds: list[str] | None = Field(default=None, max_length=200)


class MemberRoleBody(BaseModel):
    role: str


class MemberFarmScopeBody(BaseModel):
    farmIds: list[str] | None = Field(default=None, max_length=200)


class ChangePasswordBody(BaseModel):
    currentPassword: str = Field(min_length=1, max_length=200)
    newPassword: str = Field(min_length=10, max_length=200)


class PasswordResetRequestBody(BaseModel):
    email: str = Field(min_length=5, max_length=255)


class PasswordResetConfirmBody(BaseModel):
    token: str = Field(min_length=24, max_length=256)
    newPassword: str = Field(min_length=10, max_length=200)


class MemberStatusBody(BaseModel):
    isActive: bool


class BillingRequestBody(BaseModel):
    requestedPlan: str
    billingCycle: str = "monthly"
    contactPhone: str = Field(default="", max_length=40)
    message: str = Field(default="", max_length=1000)


class BillingResolveBody(BaseModel):
    status: str
    subscriptionEndsAt: str | None = None
    adminNote: str = Field(default="", max_length=1000)


@app.get("/api/health")
def health() -> dict[str, Any]:
    with db_session() as con:
        con.execute("SELECT 1").fetchone()
    return {"ok": True, "product": "PigProfit AI", "mode": "fullstack", "version": "1.8.0", "database": "sqlite", "serverTime": iso()}


@app.post("/api/auth/register")
def register(body: RegisterBody, request: Request) -> dict[str, Any]:
    name = body.name.strip()
    tenant_name = body.tenantName.strip()
    email = body.email.strip().lower()
    reg_key = _rate_key(request, "register")
    _check_rate_limit(reg_key, AUTH_MAX_REGISTRATIONS_PER_WINDOW, "Quá nhiều yêu cầu tạo tài khoản từ địa chỉ này. Hãy thử lại sau 15 phút.")
    _record_rate_attempt(reg_key)
    if len(name) < 2 or len(tenant_name) < 2:
        raise HTTPException(422, "Tên chủ tài khoản và tên workspace phải có ít nhất 2 ký tự không tính khoảng trắng.")
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(422, "Địa chỉ email không hợp lệ.")
    if len(body.password) < 10:
        raise HTTPException(422, "Mật khẩu phải có ít nhất 10 ký tự.")
    initial = validate_snapshot(body.initialData) if body.initialData else blank_snapshot(tenant_name)
    with db_session() as con:
        exists = con.execute("SELECT 1 FROM users WHERE lower(email)=? LIMIT 1", (email,)).fetchone()
    if exists:
        raise HTTPException(409, "Email này đã được dùng trong hệ thống. Hãy đăng nhập hoặc dùng email khác.")
    tenant_id, user_id = str(uuid.uuid4()), str(uuid.uuid4())
    now = iso()
    with db_session() as con:
        try:
            con.execute("INSERT INTO tenants(id,name,plan,status,created_at) VALUES(?,?,?,?,?)", (tenant_id, tenant_name, "trial", "active", now))
            con.execute("INSERT INTO users(id,tenant_id,email,name,password_hash,role,is_active,created_at) VALUES(?,?,?,?,?,?,1,?)",
                        (user_id, tenant_id, email, name, password_hash(body.password), "owner", now))
            con.execute("INSERT INTO snapshots(tenant_id,revision,payload,updated_by,updated_at) VALUES(?,?,?,?,?)",
                        (tenant_id, 1 if body.initialData else 0, json.dumps(initial, ensure_ascii=False), user_id, now))
            con.execute("INSERT INTO audit_log(tenant_id,user_id,action,detail,created_at) VALUES(?,?,?,?,?)",
                        (tenant_id, user_id, "workspace.created", json.dumps({"email": email}, ensure_ascii=False), now))
            token, expiry = new_session(con, user_id)
        except sqlite3.IntegrityError:
            raise HTTPException(409, "Email này đã được dùng trong hệ thống hoặc dữ liệu workspace không hợp lệ.")
    return {"token": token, "expiresAt": expiry, "user": {"id": user_id, "tenantId": tenant_id, "email": email, "name": name, "role": "owner", "tenantName": tenant_name, "plan": "trial"}}


@app.post("/api/auth/login")
def login(body: LoginBody, request: Request) -> dict[str, Any]:
    email = body.email.strip().lower()
    attempt_key = _rate_key(request, "login", email)
    _check_rate_limit(attempt_key, AUTH_MAX_FAILED_LOGINS, "Đã nhập sai quá nhiều lần. Hãy thử lại sau 15 phút.")
    with db_session() as con:
        rows = con.execute("SELECT * FROM users WHERE lower(email)=? ORDER BY created_at", (email,)).fetchall()
        if len(rows) > 1:
            raise HTTPException(409, "Email này đang trùng giữa nhiều workspace trong dữ liệu cũ. Quản trị viên cần xử lý trùng email trước khi đăng nhập.")
        row = rows[0] if rows else None
        if not row or not password_verify(body.password, row["password_hash"]):
            _record_rate_attempt(attempt_key)
            # Use a generic response so the endpoint does not reveal account existence.
            raise HTTPException(401, "Email hoặc mật khẩu không chính xác.")
        if not row["is_active"]:
            raise HTTPException(403, "Tài khoản đã bị khóa.")
        tenant = con.execute("SELECT * FROM tenants WHERE id=?", (row["tenant_id"],)).fetchone()
        if not tenant or tenant["status"] != "active":
            raise HTTPException(403, "Workspace đã bị tạm khóa.")
        token, expiry = new_session(con, row["id"])
        with _AUTH_ATTEMPTS_LOCK:
            _AUTH_ATTEMPTS.pop(attempt_key, None)
        con.execute("INSERT INTO audit_log(tenant_id,user_id,action,detail,created_at) VALUES(?,?,?,?,?)",
                    (row["tenant_id"], row["id"], "auth.login", None, iso()))
        user = public_user(row)
        user.update({"tenantName": tenant["name"], "plan": tenant["plan"]})
        return {"token": token, "expiresAt": expiry, "user": user}


@app.post("/api/auth/logout")
def logout(current: dict[str, Any] = Depends(get_current_user), authorization: str | None = Header(default=None)) -> dict[str, bool]:
    token = authorization.split(" ", 1)[1].strip()
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with db_session() as con:
        con.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))
        con.execute("INSERT INTO audit_log(tenant_id,user_id,action,detail,created_at) VALUES(?,?,?,?,?)",
                    (current["tenantId"], current["id"], "auth.logout", None, iso()))
    return {"ok": True}


@app.get("/api/auth/me")
def me(current: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    return current


@app.post("/api/auth/change-password")
def change_password(body: ChangePasswordBody, current: dict[str, Any] = Depends(get_current_user), authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if body.currentPassword == body.newPassword:
        raise HTTPException(422, "Mật khẩu mới phải khác mật khẩu hiện tại.")
    token = (authorization or "").split(" ", 1)[-1].strip()
    current_token_hash = hashlib.sha256(token.encode()).hexdigest()
    with db_session() as con:
        user = con.execute("SELECT password_hash FROM users WHERE id=? AND tenant_id=?", (current["id"], current["tenantId"])).fetchone()
        if not user or not password_verify(body.currentPassword, user["password_hash"]):
            raise HTTPException(401, "Mật khẩu hiện tại không chính xác.")
        con.execute("UPDATE users SET password_hash=? WHERE id=? AND tenant_id=?", (password_hash(body.newPassword), current["id"], current["tenantId"]))
        con.execute("DELETE FROM sessions WHERE user_id=? AND token_hash<>?", (current["id"], current_token_hash))
        con.execute("INSERT INTO audit_log(tenant_id,user_id,action,detail,created_at) VALUES(?,?,?,?,?)",
                    (current["tenantId"], current["id"], "auth.password_changed", None, iso()))
    return {"ok": True, "message": "Đã đổi mật khẩu. Các phiên đăng nhập khác đã bị thu hồi."}


def _password_reset_email_configured() -> bool:
    """Return true only when both a trusted public URL and SMTP sender are configured."""
    host = os.getenv("PIGPROFIT_SMTP_HOST", "").strip()
    sender = os.getenv("PIGPROFIT_SMTP_FROM", "").strip()
    public_url = os.getenv("PIGPROFIT_PUBLIC_URL", "").strip().rstrip("/")
    return bool(host and sender and public_url.startswith("https://"))


def _send_password_reset_email(to_email: str, raw_token: str) -> None:
    """Send a one-time reset link; secret token is never written to logs or the database."""
    host = os.getenv("PIGPROFIT_SMTP_HOST", "").strip()
    if not host:
        raise RuntimeError("SMTP chưa được cấu hình")
    port = int(os.getenv("PIGPROFIT_SMTP_PORT", "587"))
    sender = os.getenv("PIGPROFIT_SMTP_FROM", "").strip()
    public_url = os.getenv("PIGPROFIT_PUBLIC_URL", "").strip().rstrip("/")
    if not sender or not public_url.startswith("https://"):
        raise RuntimeError("Thiếu email người gửi hoặc URL HTTPS công khai")
    reset_url = f"{public_url}/?reset_token={quote(raw_token, safe='')}"
    message = EmailMessage()
    message["Subject"] = "Đặt lại mật khẩu PigProfit AI"
    message["From"] = sender
    message["To"] = to_email
    message.set_content(
        "Bạn vừa yêu cầu đặt lại mật khẩu PigProfit AI.\n\n"
        f"Mở đường dẫn sau trong vòng {PASSWORD_RESET_TOKEN_MINUTES} phút: \n{reset_url}\n\n"
        "Nếu bạn không yêu cầu, hãy bỏ qua email này. Liên kết chỉ dùng được một lần."
    )
    use_ssl = os.getenv("PIGPROFIT_SMTP_SSL", "false").strip().lower() in ("1", "true", "yes")
    use_starttls = os.getenv("PIGPROFIT_SMTP_STARTTLS", "true").strip().lower() in ("1", "true", "yes")
    timeout = max(3, min(int(os.getenv("PIGPROFIT_SMTP_TIMEOUT", "10")), 30))
    client_cls = smtplib.SMTP_SSL if use_ssl else smtplib.SMTP
    context = ssl.create_default_context()
    with client_cls(host, port, timeout=timeout, context=context) if use_ssl else client_cls(host, port, timeout=timeout) as smtp:
        smtp.ehlo()
        if use_starttls and not use_ssl:
            smtp.starttls(context=context)
            smtp.ehlo()
        username = os.getenv("PIGPROFIT_SMTP_USER", "").strip()
        password = os.getenv("PIGPROFIT_SMTP_PASSWORD", "")
        if username:
            smtp.login(username, password)
        smtp.send_message(message)


PASSWORD_RESET_GENERIC_MESSAGE = (
    "Nếu email thuộc một tài khoản đang hoạt động và dịch vụ email đã được cấu hình, "
    "hướng dẫn đặt lại mật khẩu sẽ được gửi đến hộp thư của bạn."
)


@app.post("/api/auth/password-reset/request")
def request_password_reset(body: PasswordResetRequestBody, request: Request) -> dict[str, Any]:
    email = body.email.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        # Keep the same public response to reduce account-enumeration signals.
        return {"ok": True, "message": PASSWORD_RESET_GENERIC_MESSAGE}
    ip_key = _rate_key(request, "password-reset-ip")
    email_key = _rate_key(request, "password-reset-email", email)
    _check_rate_limit(ip_key, PASSWORD_RESET_MAX_PER_IP, "Quá nhiều yêu cầu đặt lại mật khẩu. Hãy thử lại sau 15 phút.")
    _check_rate_limit(email_key, PASSWORD_RESET_MAX_PER_EMAIL, "Quá nhiều yêu cầu đặt lại mật khẩu. Hãy thử lại sau 15 phút.")
    _record_rate_attempt(ip_key)
    _record_rate_attempt(email_key)
    if not _password_reset_email_configured():
        return {"ok": True, "message": PASSWORD_RESET_GENERIC_MESSAGE}
    with db_session() as con:
        user = con.execute("SELECT id,is_active,tenant_id FROM users WHERE lower(email)=? LIMIT 1", (email,)).fetchone()
        if not user or not user["is_active"]:
            return {"ok": True, "message": PASSWORD_RESET_GENERIC_MESSAGE}
        tenant = con.execute("SELECT status FROM tenants WHERE id=?", (user["tenant_id"],)).fetchone()
        if not tenant or tenant["status"] != "active":
            return {"ok": True, "message": PASSWORD_RESET_GENERIC_MESSAGE}
        # Keep only one active reset token per account and periodically clean expired tokens.
        now = iso()
        con.execute("UPDATE password_reset_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL", (now, user["id"]))
        con.execute("DELETE FROM password_reset_tokens WHERE expires_at<? OR used_at IS NOT NULL", (now,))
        raw_token = secrets.token_urlsafe(40)
        token_digest = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        expires_at = iso(utcnow() + timedelta(minutes=PASSWORD_RESET_TOKEN_MINUTES))
        con.execute("INSERT INTO password_reset_tokens(token_hash,user_id,expires_at,used_at,created_at) VALUES(?,?,?,NULL,?)",
                    (token_digest, user["id"], expires_at, now))
    try:
        _send_password_reset_email(email, raw_token)
    except Exception:
        logger.exception("Could not deliver password reset email")
        with db_session() as con:
            con.execute("DELETE FROM password_reset_tokens WHERE token_hash=?", (token_digest,))
    return {"ok": True, "message": PASSWORD_RESET_GENERIC_MESSAGE}


@app.post("/api/auth/password-reset/confirm")
def confirm_password_reset(body: PasswordResetConfirmBody, request: Request) -> dict[str, Any]:
    attempt_key = _rate_key(request, "password-reset-confirm")
    _check_rate_limit(attempt_key, 15, "Quá nhiều lần thử đặt mật khẩu mới. Hãy thử lại sau 15 phút.")
    _record_rate_attempt(attempt_key)
    if len(body.token) < 24:
        raise HTTPException(400, "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.")
    digest = hashlib.sha256(body.token.encode("utf-8")).hexdigest()
    now = iso()
    with db_session() as con:
        con.execute("BEGIN IMMEDIATE")
        row = con.execute(
            "SELECT r.user_id,u.tenant_id,u.is_active,t.status AS tenant_status FROM password_reset_tokens r "
            "JOIN users u ON u.id=r.user_id JOIN tenants t ON t.id=u.tenant_id "
            "WHERE r.token_hash=? AND r.used_at IS NULL AND r.expires_at>? LIMIT 1", (digest, now)
        ).fetchone()
        if not row or not row["is_active"] or row["tenant_status"] != "active":
            raise HTTPException(400, "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.")
        con.execute("UPDATE users SET password_hash=? WHERE id=?", (password_hash(body.newPassword), row["user_id"]))
        con.execute("UPDATE password_reset_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL", (now, digest))
        con.execute("DELETE FROM sessions WHERE user_id=?", (row["user_id"],))
        con.execute("INSERT INTO audit_log(tenant_id,user_id,action,detail,created_at) VALUES(?,?,?,?,?)",
                    (row["tenant_id"], row["user_id"], "auth.password_reset", None, now))
    with _AUTH_ATTEMPTS_LOCK:
        _AUTH_ATTEMPTS.pop(attempt_key, None)
    return {"ok": True, "message": "Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới."}


@app.get("/api/snapshot")
def get_snapshot(current: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    with db_session() as con:
        row = con.execute("SELECT revision,payload,updated_at FROM snapshots WHERE tenant_id=?", (current["tenantId"],)).fetchone()
        if not row:
            data = blank_snapshot(current["tenantName"])
            con.execute("INSERT INTO snapshots(tenant_id,revision,payload,updated_by,updated_at) VALUES(?,?,?,?,?)",
                        (current["tenantId"], 0, json.dumps(data, ensure_ascii=False), current["id"], iso()))
            return {"data": _scope_snapshot(data, current), "revision": 0, "hasData": False, "updatedAt": None}
        full_data = json.loads(row["payload"])
        data = _scope_snapshot(full_data, current)
        return {"data": data, "revision": row["revision"], "hasData": _snapshot_has_data(data), "updatedAt": row["updated_at"]}


@app.put("/api/snapshot")
def put_snapshot(body: SnapshotBody, request: Request, current: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if current["role"] == "viewer":
        raise HTTPException(403, "Tài khoản chỉ xem không có quyền sửa dữ liệu.")
    data = validate_snapshot(body.data)
    now = iso()
    with db_session() as con:
        con.execute("BEGIN IMMEDIATE")
        row = con.execute("SELECT revision,payload FROM snapshots WHERE tenant_id=?", (current["tenantId"],)).fetchone()
        if not row:
            current_revision = 0
            existing_data = blank_snapshot(current["tenantName"])
            con.execute("INSERT INTO snapshots(tenant_id,revision,payload,updated_by,updated_at) VALUES(?,?,?,?,?)",
                        (current["tenantId"], 0, json.dumps(existing_data, ensure_ascii=False), current["id"], now))
        else:
            current_revision = row["revision"]
            existing_data = json.loads(row["payload"])
        if body.expectedRevision != current_revision:
            con.rollback()
            raise HTTPException(409, detail={"message": "Dữ liệu trên máy chủ đã được thay đổi từ thiết bị khác.", "currentRevision": current_revision})
        if current.get("allFarms", True):
            merged_data = data
        else:
            merged_data = _merge_scoped_snapshot(existing_data, data, current)
        payload = json.dumps(merged_data, ensure_ascii=False, separators=(",", ":"))
        next_revision = current_revision + 1
        con.execute("UPDATE snapshots SET revision=?,payload=?,updated_by=?,updated_at=? WHERE tenant_id=?",
                    (next_revision, payload, current["id"], now, current["tenantId"]))
        con.execute("INSERT INTO audit_log(tenant_id,user_id,action,detail,created_at) VALUES(?,?,?,?,?)",
                    (current["tenantId"], current["id"], "snapshot.updated", json.dumps({"revision": next_revision, "bytes": len(payload)}, ensure_ascii=False), now))
        con.commit()
    return {"ok": True, "revision": next_revision, "updatedAt": now}


@app.get("/api/members")
def list_members(current: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if current["role"] not in ("owner", "manager") or not current.get("allFarms", True):
        raise HTTPException(403, "Chỉ chủ workspace hoặc quản lý có quyền toàn trại mới được xem danh sách thành viên.")
    with db_session() as con:
        rows = con.execute("SELECT id,email,name,role,farm_scope,is_active,created_at FROM users WHERE tenant_id=? ORDER BY created_at", (current["tenantId"],)).fetchall()
    members = []
    for r in rows:
        scope = _parse_farm_scope(r["farm_scope"])
        members.append({"id": r["id"], "email": r["email"], "name": r["name"], "role": r["role"], "allFarms": "*" in scope, "farmIds": None if "*" in scope else scope, "isActive": bool(r["is_active"]), "createdAt": r["created_at"]})
    return {"members": members}


@app.post("/api/members")
def add_member(body: MemberBody, current: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if current["role"] != "owner":
        raise HTTPException(403, "Chỉ chủ workspace mới được thêm thành viên.")
    email = body.email.strip().lower()
    name = body.name.strip()
    if len(name) < 2:
        raise HTTPException(422, "Tên thành viên phải có ít nhất 2 ký tự không tính khoảng trắng.")
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(422, "Địa chỉ email không hợp lệ.")
    if len(body.password) < 10:
        raise HTTPException(422, "Mật khẩu phải có ít nhất 10 ký tự.")
    if body.role not in ("manager", "editor", "viewer"):
        raise HTTPException(422, "Vai trò phải là manager, editor hoặc viewer.")
    requested_scope = ["*"] if body.farmIds is None else list(dict.fromkeys(body.farmIds))
    if body.farmIds is not None and not requested_scope:
        raise HTTPException(422, "Hãy chọn ít nhất một trang trại hoặc chọn toàn workspace.")
    with db_session() as con:
        snapshot_row = con.execute("SELECT payload FROM snapshots WHERE tenant_id=?", (current["tenantId"],)).fetchone()
        tenant_farms = {str(f.get("id", "")) for f in json.loads(snapshot_row["payload"]).get("settings", {}).get("farms", [])} if snapshot_row else set()
        if "*" not in requested_scope and not set(requested_scope).issubset(tenant_farms):
            raise HTTPException(422, "Phạm vi có trang trại không tồn tại trong workspace.")
        if con.execute("SELECT 1 FROM users WHERE lower(email)=? LIMIT 1", (email,)).fetchone():
            raise HTTPException(409, "Email này đã có tài khoản trong hệ thống.")
    user_id, now = str(uuid.uuid4()), iso()
    with db_session() as con:
        try:
            con.execute("INSERT INTO users(id,tenant_id,email,name,password_hash,role,farm_scope,is_active,created_at) VALUES(?,?,?,?,?,?,?,1,?)",
                        (user_id, current["tenantId"], email, name, password_hash(body.password), body.role, json.dumps(requested_scope, ensure_ascii=False), now))
            con.execute("INSERT INTO audit_log(tenant_id,user_id,action,detail,created_at) VALUES(?,?,?,?,?)",
                        (current["tenantId"], current["id"], "member.created", json.dumps({"email": email, "role": body.role}, ensure_ascii=False), now))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "Email này đã có tài khoản trong hệ thống.")
    return {"member": {"id": user_id, "email": email, "name": name, "role": body.role, "allFarms": "*" in requested_scope, "farmIds": None if "*" in requested_scope else requested_scope, "isActive": True, "createdAt": now}}


@app.patch("/api/members/{member_id}/role")
def update_member_role(member_id: str, body: MemberRoleBody, current: dict[str, Any] = Depends(get_current_user)) -> dict[str, bool]:
    if current["role"] != "owner":
        raise HTTPException(403, "Chỉ chủ workspace mới được thay đổi vai trò thành viên.")
    if member_id == current["id"] or body.role not in ("manager", "editor", "viewer"):
        raise HTTPException(422, "Không thể thay đổi vai trò của chính chủ workspace hoặc vai trò không hợp lệ.")
    with db_session() as con:
        target = con.execute("SELECT id FROM users WHERE id=? AND tenant_id=? AND role!='owner'", (member_id, current["tenantId"])).fetchone()
        if not target:
            raise HTTPException(404, "Không tìm thấy thành viên.")
        con.execute("UPDATE users SET role=? WHERE id=? AND tenant_id=?", (body.role, member_id, current["tenantId"]))
        con.execute("INSERT INTO audit_log(tenant_id,user_id,action,detail,created_at) VALUES(?,?,?,?,?)", (current["tenantId"], current["id"], "member.role", json.dumps({"memberId": member_id, "role": body.role}), iso()))
    return {"ok": True}


@app.patch("/api/members/{member_id}/farms")
def update_member_farms(member_id: str, body: MemberFarmScopeBody, current: dict[str, Any] = Depends(get_current_user)) -> dict[str, bool]:
    if current["role"] != "owner":
        raise HTTPException(403, "Chỉ chủ workspace mới được thay đổi phạm vi trang trại thành viên.")
    if member_id == current["id"]:
        raise HTTPException(422, "Không thể thay đổi phạm vi của chính chủ workspace.")
    requested_scope = ["*"] if body.farmIds is None else list(dict.fromkeys(body.farmIds))
    if body.farmIds is not None and not requested_scope:
        raise HTTPException(422, "Hãy chọn ít nhất một trang trại hoặc chọn toàn workspace.")
    with db_session() as con:
        target = con.execute("SELECT id,role FROM users WHERE id=? AND tenant_id=? AND role!='owner'", (member_id, current["tenantId"])).fetchone()
        if not target:
            raise HTTPException(404, "Không tìm thấy thành viên.")
        if target["role"] == "owner":
            raise HTTPException(422, "Không thể giới hạn quyền truy cập của chủ workspace.")
        snap = con.execute("SELECT payload FROM snapshots WHERE tenant_id=?", (current["tenantId"],)).fetchone()
        tenant_farms = {str(f.get("id", "")) for f in json.loads(snap["payload"]).get("settings", {}).get("farms", [])} if snap else set()
        if "*" not in requested_scope and not set(requested_scope).issubset(tenant_farms):
            raise HTTPException(422, "Phạm vi có trang trại không tồn tại trong workspace.")
        con.execute("UPDATE users SET farm_scope=? WHERE id=? AND tenant_id=?", (json.dumps(requested_scope, ensure_ascii=False), member_id, current["tenantId"]))
        con.execute("INSERT INTO audit_log(tenant_id,user_id,action,detail,created_at) VALUES(?,?,?,?,?)", (current["tenantId"], current["id"], "member.farms", json.dumps({"memberId": member_id, "farmIds": requested_scope}), iso()))
        # Revoke existing sessions so the new scope is applied immediately on all devices.
        con.execute("DELETE FROM sessions WHERE user_id=?", (member_id,))
    return {"ok": True}


@app.patch("/api/members/{member_id}/status")
def member_status(member_id: str, body: MemberStatusBody, current: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if current["role"] != "owner":
        raise HTTPException(403, "Chỉ chủ workspace mới được thay đổi trạng thái thành viên.")
    if member_id == current["id"] and not body.isActive:
        raise HTTPException(422, "Không thể tự khóa tài khoản đang đăng nhập.")
    with db_session() as con:
        cur = con.execute("UPDATE users SET is_active=? WHERE id=? AND tenant_id=? AND role!='owner'", (1 if body.isActive else 0, member_id, current["tenantId"]))
        if cur.rowcount == 0:
            raise HTTPException(404, "Không tìm thấy thành viên hoặc không thể khóa chủ workspace.")
        if not body.isActive:
            con.execute("DELETE FROM sessions WHERE user_id=?", (member_id,))
        con.execute("INSERT INTO audit_log(tenant_id,user_id,action,detail,created_at) VALUES(?,?,?,?,?)",
                    (current["tenantId"], current["id"], "member.status", json.dumps({"memberId": member_id, "isActive": body.isActive}), iso()))
    return {"ok": True}


@app.get("/api/audit")
def get_audit(limit: int = 50, current: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if current["role"] not in ("owner", "manager") or not current.get("allFarms", True):
        raise HTTPException(403, "Chỉ chủ workspace hoặc quản lý có quyền toàn trại mới được xem nhật ký quản trị.")
    limit = max(1, min(int(limit), 200))
    with db_session() as con:
        rows = con.execute("SELECT a.id,a.user_id,a.action,a.detail,a.created_at,u.email FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.tenant_id=? ORDER BY a.id DESC LIMIT ?", (current["tenantId"], limit)).fetchall()
    return {"events": [{"id": r["id"], "userId": r["user_id"], "email": r["email"], "action": r["action"], "detail": r["detail"], "createdAt": r["created_at"]} for r in rows]}


BILLING_PLANS = [
    {"id": "trial", "name": "Dùng thử", "priceVnd": 0, "priceLabel": "Miễn phí", "features": ["Một workspace", "Dữ liệu nhật ký cơ bản", "Báo cáo lứa nuôi"]},
    {"id": "starter", "name": "Cơ bản", "priceVnd": 199000, "priceLabel": "199.000 đ/tháng (giá thử nghiệm)", "features": ["Quản lý cám và chi phí", "Cân, FCR, báo cáo", "Hỗ trợ qua kênh trực tuyến"]},
    {"id": "professional", "name": "Chuyên nghiệp", "priceVnd": 399000, "priceLabel": "399.000 đ/tháng (giá thử nghiệm)", "features": ["Nhiều trang trại và nhân viên", "Phân quyền, QR, báo cáo tổng hợp", "Ưu tiên hỗ trợ"]},
    {"id": "enterprise", "name": "Doanh nghiệp", "priceVnd": None, "priceLabel": "Liên hệ báo giá", "features": ["Quản lý nhiều cơ sở", "Triển khai và đào tạo", "Phạm vi hỗ trợ theo hợp đồng"]},
]


def _billing_request_json(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"], "tenantId": row["tenant_id"], "requestedBy": row["user_id"],
        "requestedPlan": row["requested_plan"], "billingCycle": row["billing_cycle"],
        "contactPhone": row["contact_phone"], "message": row["message"], "status": row["status"],
        "createdAt": row["created_at"], "resolvedAt": row["resolved_at"], "adminNote": row["admin_note"],
    }


def _require_platform_admin(token: str | None, request: Request) -> None:
    expected = os.getenv("PIGPROFIT_ADMIN_TOKEN", "").strip()
    if not expected:
        raise HTTPException(503, "Chưa cấu hình PIGPROFIT_ADMIN_TOKEN trên máy chủ.")
    if not token or not hmac.compare_digest(token, expected):
        key = _rate_key(request, "platform-admin")
        _check_rate_limit(key, 20, "Quá nhiều lần thử xác thực quản trị nền tảng. Hãy thử lại sau 15 phút.")
        _record_rate_attempt(key)
        raise HTTPException(401, "Không có quyền quản trị nền tảng.")
    with _AUTH_ATTEMPTS_LOCK:
        _AUTH_ATTEMPTS.pop(_rate_key(request, "platform-admin"), None)


@app.get("/api/billing/current")
def current_billing(current: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    with db_session() as con:
        tenant = con.execute("SELECT id,name,plan,status,created_at,subscription_ends_at FROM tenants WHERE id=?", (current["tenantId"],)).fetchone()
        user_count = con.execute("SELECT COUNT(*) n FROM users WHERE tenant_id=? AND is_active=1", (current["tenantId"],)).fetchone()["n"]
        rows = con.execute("SELECT * FROM billing_requests WHERE tenant_id=? ORDER BY created_at DESC LIMIT 10", (current["tenantId"],)).fetchall()
    if not tenant:
        raise HTTPException(404, "Không tìm thấy workspace.")
    snapshot = {}
    try:
        with db_session() as con:
            row = con.execute("SELECT payload FROM snapshots WHERE tenant_id=?", (current["tenantId"],)).fetchone()
        snapshot = json.loads(row["payload"]) if row else {}
    except (TypeError, json.JSONDecodeError):
        snapshot = {}
    settings = snapshot.get("settings", {}) if isinstance(snapshot, dict) else {}
    farms = settings.get("farms", []) if isinstance(settings, dict) else []
    batches = snapshot.get("batches", []) if isinstance(snapshot, dict) else []
    active_batches = sum(1 for b in batches if b.get("status", "active") != "closed")
    return {
        "workspace": {"id": tenant["id"], "name": tenant["name"], "plan": tenant["plan"], "status": tenant["status"], "createdAt": tenant["created_at"], "subscriptionEndsAt": tenant["subscription_ends_at"]},
        "usage": {"activeMembers": int(user_count), "farms": len(farms), "batches": len(batches), "activeBatches": active_batches},
        "plans": BILLING_PLANS,
        "requests": [_billing_request_json(r) for r in rows],
        "paymentsEnabled": False,
    }


@app.post("/api/billing/requests")
def create_billing_request(body: BillingRequestBody, request: Request, current: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if current["role"] != "owner":
        raise HTTPException(403, "Chỉ chủ workspace mới được yêu cầu nâng cấp gói dịch vụ.")
    if body.requestedPlan not in ("starter", "professional", "enterprise"):
        raise HTTPException(422, "Gói yêu cầu không hợp lệ.")
    if body.billingCycle not in ("monthly", "annual"):
        raise HTTPException(422, "Chu kỳ thanh toán phải là monthly hoặc annual.")
    key = _rate_key(request, "billing-request", current["tenantId"])
    _check_rate_limit(key, 5, "Bạn đã gửi nhiều yêu cầu nâng cấp. Hãy chờ bộ phận hỗ trợ phản hồi.")
    _record_rate_attempt(key)
    request_id, now = str(uuid.uuid4()), iso()
    with db_session() as con:
        pending = con.execute("SELECT id FROM billing_requests WHERE tenant_id=? AND status='pending' LIMIT 1", (current["tenantId"],)).fetchone()
        if pending:
            raise HTTPException(409, "Workspace đã có yêu cầu nâng cấp đang chờ xử lý. Hãy chờ phản hồi trước khi gửi yêu cầu mới.")
        con.execute("INSERT INTO billing_requests(id,tenant_id,user_id,requested_plan,billing_cycle,contact_phone,message,status,created_at) VALUES(?,?,?,?,?,?,?,'pending',?)",
                    (request_id, current["tenantId"], current["id"], body.requestedPlan, body.billingCycle, body.contactPhone.strip(), body.message.strip(), now))
        con.execute("INSERT INTO audit_log(tenant_id,user_id,action,detail,created_at) VALUES(?,?,?,?,?)",
                    (current["tenantId"], current["id"], "billing.requested", json.dumps({"requestId": request_id, "plan": body.requestedPlan, "cycle": body.billingCycle}, ensure_ascii=False), now))
        row = con.execute("SELECT * FROM billing_requests WHERE id=?", (request_id,)).fetchone()
    notify_email = os.getenv("PIGPROFIT_BILLING_NOTIFY_EMAIL", "").strip()
    if notify_email and _password_reset_email_configured():
        try:
            _send_billing_notification(notify_email, current, body, request_id)
        except Exception:
            logger.exception("Could not deliver billing notification")
    return {"ok": True, "request": _billing_request_json(row), "message": "Đã ghi nhận yêu cầu nâng cấp. Bộ phận hỗ trợ sẽ liên hệ để xác nhận gói và thanh toán."}


def _send_billing_notification(to_email: str, current: dict[str, Any], body: BillingRequestBody, request_id: str) -> None:
    host = os.getenv("PIGPROFIT_SMTP_HOST", "").strip()
    port = int(os.getenv("PIGPROFIT_SMTP_PORT", "587"))
    sender = os.getenv("PIGPROFIT_SMTP_FROM", "").strip()
    message = EmailMessage()
    message["Subject"] = f"PigProfit AI: Yêu cầu gói {body.requestedPlan}"
    message["From"] = sender
    message["To"] = to_email
    message.set_content(
        f"Có yêu cầu nâng cấp PigProfit AI mới.\\nMã: {request_id}\\nWorkspace: {current.get('tenantName','')}\\n"
        f"Người yêu cầu: {current.get('email','')}\\nGói: {body.requestedPlan}\\nChu kỳ: {body.billingCycle}\\n"
        f"Điện thoại: {body.contactPhone}\\nGhi chú: {body.message}"
    )
    use_ssl = os.getenv("PIGPROFIT_SMTP_SSL", "false").strip().lower() in ("1", "true", "yes")
    use_starttls = os.getenv("PIGPROFIT_SMTP_STARTTLS", "true").strip().lower() in ("1", "true", "yes")
    context = ssl.create_default_context()
    timeout = max(3, min(int(os.getenv("PIGPROFIT_SMTP_TIMEOUT", "10")), 30))
    if use_ssl:
        with smtplib.SMTP_SSL(host, port, timeout=timeout, context=context) as smtp:
            username=os.getenv("PIGPROFIT_SMTP_USER", "").strip()
            if username: smtp.login(username, os.getenv("PIGPROFIT_SMTP_PASSWORD", ""))
            smtp.send_message(message)
    else:
        with smtplib.SMTP(host, port, timeout=timeout) as smtp:
            smtp.ehlo()
            if use_starttls: smtp.starttls(context=context); smtp.ehlo()
            username=os.getenv("PIGPROFIT_SMTP_USER", "").strip()
            if username: smtp.login(username, os.getenv("PIGPROFIT_SMTP_PASSWORD", ""))
            smtp.send_message(message)


@app.get("/api/platform/workspaces")
def platform_workspaces(request: Request, x_platform_admin_token: str | None = Header(default=None)) -> dict[str, Any]:
    _require_platform_admin(x_platform_admin_token, request)
    with db_session() as con:
        rows = con.execute("""
            SELECT t.id,t.name,t.plan,t.status,t.created_at,t.subscription_ends_at,
                   COUNT(DISTINCT u.id) AS user_count,
                   COUNT(DISTINCT CASE WHEN u.is_active=1 THEN u.id END) AS active_user_count
            FROM tenants t LEFT JOIN users u ON u.tenant_id=t.id
            GROUP BY t.id ORDER BY t.created_at DESC LIMIT 500
        """).fetchall()
        workspace_list = []
        for r in rows:
            snap = con.execute("SELECT payload FROM snapshots WHERE tenant_id=?", (r["id"],)).fetchone()
            try: payload = json.loads(snap["payload"]) if snap else {}
            except (TypeError, json.JSONDecodeError): payload = {}
            farms = payload.get("settings", {}).get("farms", []) if isinstance(payload, dict) else []
            request_count = con.execute("SELECT COUNT(*) n FROM billing_requests WHERE tenant_id=? AND status='pending'", (r["id"],)).fetchone()["n"]
            workspace_list.append({"id":r["id"],"name":r["name"],"plan":r["plan"],"status":r["status"],"createdAt":r["created_at"],"subscriptionEndsAt":r["subscription_ends_at"],"users":int(r["user_count"]),"activeUsers":int(r["active_user_count"]),"farms":len(farms),"pendingBillingRequests":int(request_count)})
    return {"workspaces": workspace_list, "count": len(workspace_list)}


@app.get("/api/platform/billing-requests")
def platform_billing_requests(request: Request, status: str = "pending", limit: int = 100, x_platform_admin_token: str | None = Header(default=None)) -> dict[str, Any]:
    _require_platform_admin(x_platform_admin_token, request)
    if status not in ("pending", "approved", "rejected", "all"):
        raise HTTPException(422, "Trạng thái yêu cầu không hợp lệ.")
    limit = max(1, min(int(limit), 500))
    with db_session() as con:
        where = "" if status == "all" else "WHERE b.status=?"
        params: tuple[Any, ...] = () if status == "all" else (status,)
        rows = con.execute(f"""SELECT b.*,t.name AS tenant_name,u.email AS requester_email
                              FROM billing_requests b JOIN tenants t ON t.id=b.tenant_id
                              JOIN users u ON u.id=b.user_id {where}
                              ORDER BY b.created_at DESC LIMIT ?""", (*params, limit)).fetchall()
    return {"requests": [{**_billing_request_json(r), "tenantName": r["tenant_name"], "requesterEmail": r["requester_email"]} for r in rows]}


@app.patch("/api/platform/billing-requests/{request_id}")
def resolve_billing_request(request_id: str, body: BillingResolveBody, request: Request, x_platform_admin_token: str | None = Header(default=None)) -> dict[str, Any]:
    _require_platform_admin(x_platform_admin_token, request)
    if body.status not in ("approved", "rejected"):
        raise HTTPException(422, "Chỉ có thể duyệt hoặc từ chối yêu cầu.")
    period_end = None
    if body.subscriptionEndsAt:
        try:
            period_end = datetime.fromisoformat(body.subscriptionEndsAt.replace("Z", "+00:00")).date().isoformat()
        except ValueError:
            try: period_end = datetime.strptime(body.subscriptionEndsAt, "%Y-%m-%d").date().isoformat()
            except ValueError: raise HTTPException(422, "Ngày hết hạn phải theo định dạng YYYY-MM-DD hoặc ISO date.")
    if body.status == "approved" and not period_end:
        raise HTTPException(422, "Khi duyệt gói trả phí cần ghi ngày hết hạn thuê bao.")
    now = iso()
    with db_session() as con:
        con.execute("BEGIN IMMEDIATE")
        row = con.execute("SELECT * FROM billing_requests WHERE id=?", (request_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Không tìm thấy yêu cầu nâng cấp.")
        if row["status"] != "pending":
            raise HTTPException(409, "Yêu cầu này đã được xử lý.")
        con.execute("UPDATE billing_requests SET status=?,resolved_at=?,admin_note=? WHERE id=?",
                    (body.status, now, body.adminNote.strip(), request_id))
        if body.status == "approved":
            con.execute("UPDATE tenants SET plan=?,status='active',subscription_ends_at=? WHERE id=?",
                        (row["requested_plan"], period_end, row["tenant_id"]))
        con.execute("INSERT INTO audit_log(tenant_id,user_id,action,detail,created_at) VALUES(?,NULL,?,?,?)",
                    (row["tenant_id"], "billing.request." + body.status, json.dumps({"requestId":request_id,"plan":row["requested_plan"],"subscriptionEndsAt":period_end,"note":body.adminNote.strip()}, ensure_ascii=False), now))
        resolved = con.execute("SELECT * FROM billing_requests WHERE id=?", (request_id,)).fetchone()
    return {"ok": True, "request": _billing_request_json(resolved)}


@app.get("/api/qr")
def qr(request: Request, text: str = "", size: int = 220) -> Response:
    qr_rate_key = _rate_key(request, "qr")
    _check_rate_limit(qr_rate_key, 1000, "Đã tạo quá nhiều yêu cầu QR. Hãy thử lại sau 15 phút.")
    _record_rate_attempt(qr_rate_key)
    if not text or len(text) > 160:
        raise HTTPException(422, "Nội dung QR không hợp lệ.")
    size = max(80, min(600, int(size)))
    try:
        import qrcode
        from PIL import Image
        img = qrcode.make(text, box_size=5, border=2)
        img = img.resize((size, size))
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        return Response(buf.getvalue(), media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})
    except ImportError:
        raise HTTPException(503, "Dịch vụ QR chưa được cài; hãy cài dependencies trong requirements.txt.")


# Serve only the explicit browser assets. Mounting BASE_DIR with StaticFiles would
# accidentally expose server.py, tests, backups, environment files, and other secrets.
STATIC_ASSETS = {
    "index.html": "text/html; charset=utf-8",
    "app.js": "text/javascript; charset=utf-8",
    "styles.css": "text/css; charset=utf-8",
    "manifest.webmanifest": "application/manifest+json",
    "icon.svg": "image/svg+xml",
    "icon-192.png": "image/png",
    "icon-512.png": "image/png",
    "sw.js": "text/javascript; charset=utf-8",
}


@app.get("/", include_in_schema=False)
def serve_home() -> FileResponse:
    return FileResponse(BASE_DIR / "index.html", media_type=STATIC_ASSETS["index.html"])


@app.get("/{asset_path:path}", include_in_schema=False)
def serve_static_asset(asset_path: str) -> FileResponse:
    media_type = STATIC_ASSETS.get(asset_path)
    if not media_type:
        raise HTTPException(404, "Không tìm thấy tài nguyên.")
    path = (BASE_DIR / asset_path).resolve()
    if path.parent != BASE_DIR.resolve() or not path.is_file():
        raise HTTPException(404, "Không tìm thấy tài nguyên.")
    return FileResponse(path, media_type=media_type)
