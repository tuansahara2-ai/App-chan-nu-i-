from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import server


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_path = tmp_path / "pigprofit-test.sqlite3"
    monkeypatch.setattr(server, "DB_PATH", db_path)
    with server._AUTH_ATTEMPTS_LOCK:
        server._AUTH_ATTEMPTS.clear()
    with TestClient(server.app) as test_client:
        yield test_client


def register(client: TestClient, email: str, tenant: str = "Trang trại kiểm thử") -> dict:
    response = client.post("/api/auth/register", json={
        "tenantName": tenant,
        "name": "Chủ trại",
        "email": email,
        "password": "SafePassword123!",
    })
    assert response.status_code == 200, response.text
    return response.json()


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def sample_snapshot(farm_name: str = "Trại A") -> dict:
    return {
        "version": 4,
        "settings": {"farmName": farm_name, "farms": [{"id": "farm-1", "name": farm_name}]},
        "batches": [{"id": "batch-1", "farmId": "farm-1", "name": "Lứa 1", "initialCount": 100}],
        "feedTypes": [{"id": "feed-1", "name": "Grower", "stage": "Grower", "priceHistory": [{"effectiveFrom": "2026-01-01", "unitPrice": 11000}]}],
        "logs": [{"id": "log-1", "batchId": "batch-1", "date": "2026-10-17", "feedKg": 10, "feedPricePerKg": 11000, "feedItems": []}],
        "weighings": [],
        "costs": [],
        "sales": [{"id": "sale-1", "batchId": "batch-1", "date": "2026-10-17", "count": 2, "totalWeightKg": 200, "pricePerKg": 65000}],
        "pigs": [{"id": "pig-1", "batchId": "batch-1", "tag": "L1-001", "status": "normal", "weightKg": 75}],
    }


def test_health_and_security_headers(client: TestClient):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["mode"] == "fullstack"
    assert response.json()["version"] == "1.8.0"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]


def test_auth_and_workspace_snapshot_isolation(client: TestClient):
    owner_a = register(client, "owner.a@example.com", "Công ty A")
    owner_b = register(client, "owner.b@example.com", "Công ty B")
    ha, hb = auth(owner_a["token"]), auth(owner_b["token"])

    blank = client.get("/api/snapshot", headers=ha)
    assert blank.status_code == 200
    put = client.put("/api/snapshot", headers=ha, json={"data": sample_snapshot("Trại A"), "expectedRevision": blank.json()["revision"]})
    assert put.status_code == 200
    assert put.json()["revision"] == 1

    remote_a = client.get("/api/snapshot", headers=ha)
    remote_b = client.get("/api/snapshot", headers=hb)
    assert remote_a.json()["data"]["sales"][0]["id"] == "sale-1"
    assert remote_a.json()["data"]["pigs"][0]["tag"] == "L1-001"
    assert remote_b.json()["data"]["batches"] == []
    assert remote_b.json()["data"]["sales"] == []


def test_snapshot_rejects_stale_revision(client: TestClient):
    owner = register(client, "revision@example.com")
    headers = auth(owner["token"])
    initial = client.get("/api/snapshot", headers=headers).json()
    first = client.put("/api/snapshot", headers=headers, json={"data": sample_snapshot(), "expectedRevision": initial["revision"]})
    assert first.status_code == 200
    stale = client.put("/api/snapshot", headers=headers, json={"data": sample_snapshot("Stale"), "expectedRevision": initial["revision"]})
    assert stale.status_code == 409
    assert "currentRevision" in stale.json()["detail"]


def test_email_is_unique_across_workspaces_case_insensitively(client: TestClient):
    register(client, "owner@example.com", "Công ty A")
    duplicate = client.post("/api/auth/register", json={
        "tenantName": "Công ty B", "name": "Người khác", "email": "OWNER@example.com", "password": "SafePassword123!"
    })
    assert duplicate.status_code == 409


def test_viewer_can_read_but_cannot_write(client: TestClient):
    owner = register(client, "owner.viewer@example.com")
    owner_headers = auth(owner["token"])
    created = client.post("/api/members", headers=owner_headers, json={
        "name": "Nhân viên xem", "email": "viewer@example.com", "password": "ViewerPassword123!", "role": "viewer"
    })
    assert created.status_code == 200
    login = client.post("/api/auth/login", json={"email": "viewer@example.com", "password": "ViewerPassword123!"})
    assert login.status_code == 200
    viewer_headers = auth(login.json()["token"])
    snapshot = client.get("/api/snapshot", headers=viewer_headers)
    assert snapshot.status_code == 200
    write = client.put("/api/snapshot", headers=viewer_headers, json={"data": sample_snapshot(), "expectedRevision": snapshot.json()["revision"]})
    assert write.status_code == 403
    assert client.post("/api/members", headers=viewer_headers, json={"name":"Xem","email":"x@example.com","password":"SafePassword123!","role":"editor"}).status_code == 403


def test_owner_can_lock_member_and_revoke_session(client: TestClient):
    owner = register(client, "owner.lock@example.com")
    owner_headers = auth(owner["token"])
    member = client.post("/api/members", headers=owner_headers, json={
        "name": "Nhập liệu", "email": "editor@example.com", "password": "EditorPassword123!", "role": "editor"
    })
    assert member.status_code == 200
    login = client.post("/api/auth/login", json={"email": "editor@example.com", "password": "EditorPassword123!"}).json()
    member_headers = auth(login["token"])
    lock = client.patch(f"/api/members/{member.json()['member']['id']}/status", headers=owner_headers, json={"isActive": False})
    assert lock.status_code == 200
    assert client.get("/api/auth/me", headers=member_headers).status_code == 401


def test_qr_endpoint_returns_png(client: TestClient):
    response = client.get("/api/qr", params={"text": "PP:L1-001", "size": 180})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/png")
    assert response.content.startswith(b"\x89PNG\r\n\x1a\n")


def test_snapshot_validation_and_size_cap(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    owner = register(client, "owner.validation@example.com")
    headers = auth(owner["token"])
    initial = client.get("/api/snapshot", headers=headers).json()
    invalid = client.put("/api/snapshot", headers=headers, json={"data": {"settings": {}}, "expectedRevision": initial["revision"]})
    assert invalid.status_code == 422


def test_logout_revokes_session(client: TestClient):
    owner = register(client, "owner.logout@example.com")
    headers = auth(owner["token"])
    assert client.get("/api/auth/me", headers=headers).status_code == 200
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_static_server_only_exposes_browser_allowlist(client: TestClient):
    home = client.get("/")
    assert home.status_code == 200
    assert "PigProfit AI" in home.text
    for asset in ("app.js", "styles.css", "manifest.webmanifest", "sw.js", "icon-192.png"):
        response = client.get(f"/{asset}")
        assert response.status_code == 200, asset
    # Do not expose application code, test fixtures, local DBs, or project docs.
    for secretish in ("/server.py", "/README.md", "/tests/test_api.py", "/data/pigprofit.sqlite3", "/.env.example", "/Dockerfile"):
        assert client.get(secretish).status_code == 404, secretish


def test_editor_can_write_but_cannot_admin_members(client: TestClient):
    owner = register(client, "owner.editor@example.com")
    owner_headers = auth(owner["token"])
    created = client.post("/api/members", headers=owner_headers, json={
        "name": "Nhập liệu", "email": "writer@example.com", "password": "WriterPassword123!", "role": "editor"
    })
    assert created.status_code == 200
    login = client.post("/api/auth/login", json={"email": "writer@example.com", "password": "WriterPassword123!"})
    assert login.status_code == 200
    writer_headers = auth(login.json()["token"])
    snap = client.get("/api/snapshot", headers=writer_headers).json()
    assert client.put("/api/snapshot", headers=writer_headers, json={"data": sample_snapshot(), "expectedRevision": snap["revision"]}).status_code == 200
    assert client.get("/api/members", headers=writer_headers).status_code == 403


def test_expired_or_missing_bearer_is_rejected(client: TestClient):
    assert client.get("/api/snapshot").status_code == 401
    assert client.get("/api/snapshot", headers=auth("not-a-real-token")).status_code == 401


def test_rate_limit_blocks_repeated_failed_logins(client: TestClient):
    payload = {"email": "notfound@example.com", "password": "WrongPassword123!"}
    for _ in range(server.AUTH_MAX_FAILED_LOGINS):
        response = client.post("/api/auth/login", json=payload)
        assert response.status_code == 401
    limited = client.post("/api/auth/login", json=payload)
    assert limited.status_code == 429
    assert limited.headers.get("retry-after")


def test_registration_rejects_whitespace_only_names(client: TestClient):
    response = client.post("/api/auth/register", json={
        "tenantName": "     ", "name": "  ", "email": "valid@example.com", "password": "StrongPassword123!"
    })
    assert response.status_code == 422


def test_password_reset_is_one_time_and_revokes_existing_sessions(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    owner = register(client, "reset.owner@example.com")
    old_headers = auth(owner["token"])
    sent: list[tuple[str, str]] = []
    monkeypatch.setenv("PIGPROFIT_SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("PIGPROFIT_SMTP_FROM", "support@example.com")
    monkeypatch.setenv("PIGPROFIT_PUBLIC_URL", "https://pigprofit.example.com")
    monkeypatch.setattr(server, "_send_password_reset_email", lambda email, token: sent.append((email, token)))

    requested = client.post("/api/auth/password-reset/request", json={"email": "RESET.OWNER@example.com"})
    assert requested.status_code == 200
    assert "Nếu email" in requested.json()["message"]
    assert len(sent) == 1
    assert sent[0][0] == "reset.owner@example.com"

    changed = client.post("/api/auth/password-reset/confirm", json={"token": sent[0][1], "newPassword": "BrandNewPassword456!"})
    assert changed.status_code == 200, changed.text
    assert client.get("/api/auth/me", headers=old_headers).status_code == 401
    login = client.post("/api/auth/login", json={"email": "reset.owner@example.com", "password": "BrandNewPassword456!"})
    assert login.status_code == 200
    reused = client.post("/api/auth/password-reset/confirm", json={"token": sent[0][1], "newPassword": "AnotherPassword456!"})
    assert reused.status_code == 400


def test_password_reset_request_does_not_reveal_account_existence(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    register(client, "exists@example.com")
    monkeypatch.setenv("PIGPROFIT_SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("PIGPROFIT_SMTP_FROM", "support@example.com")
    monkeypatch.setenv("PIGPROFIT_PUBLIC_URL", "https://pigprofit.example.com")
    sent: list[str] = []
    monkeypatch.setattr(server, "_send_password_reset_email", lambda email, token: sent.append(email))
    exists = client.post("/api/auth/password-reset/request", json={"email": "exists@example.com"})
    missing = client.post("/api/auth/password-reset/request", json={"email": "missing@example.com"})
    assert exists.status_code == missing.status_code == 200
    assert exists.json()["message"] == missing.json()["message"]
    assert sent == ["exists@example.com"]


def test_password_reset_without_smtp_does_not_create_unusable_token(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    register(client, "no.smtp@example.com")
    monkeypatch.delenv("PIGPROFIT_SMTP_HOST", raising=False)
    monkeypatch.delenv("PIGPROFIT_SMTP_FROM", raising=False)
    monkeypatch.delenv("PIGPROFIT_PUBLIC_URL", raising=False)
    response = client.post("/api/auth/password-reset/request", json={"email": "no.smtp@example.com"})
    assert response.status_code == 200
    with server.db_session() as con:
        assert con.execute("SELECT COUNT(*) n FROM password_reset_tokens").fetchone()["n"] == 0


def test_scoped_member_only_receives_assigned_farm_and_cannot_add_other_farm(client: TestClient):
    owner = register(client, "scope.owner@example.com", "Công ty nhiều trại")
    owner_headers = auth(owner["token"])
    initial = client.get("/api/snapshot", headers=owner_headers).json()
    data = {
        "version": 4,
        "settings": {"farmName": "Công ty nhiều trại", "farms": [
            {"id": "farm-a", "name": "Trại A"}, {"id": "farm-b", "name": "Trại B"}
        ]},
        "batches": [
            {"id": "batch-a", "farmId": "farm-a", "name": "Lứa A", "initialCount": 100},
            {"id": "batch-b", "farmId": "farm-b", "name": "Lứa B", "initialCount": 200}
        ],
        "feedTypes": [],
        "logs": [
            {"id": "log-a", "batchId": "batch-a", "date": "2026-10-01", "feedKg": 10},
            {"id": "log-b", "batchId": "batch-b", "date": "2026-10-01", "feedKg": 20}
        ],
        "weighings": [], "costs": [], "sales": [], "pigs": []
    }
    saved = client.put("/api/snapshot", headers=owner_headers, json={"data": data, "expectedRevision": initial["revision"]})
    assert saved.status_code == 200, saved.text
    member = client.post("/api/members", headers=owner_headers, json={
        "name": "Nhân viên trại A", "email": "scope.editor@example.com", "password": "ScopedPassword123!",
        "role": "editor", "farmIds": ["farm-a"]
    })
    assert member.status_code == 200, member.text
    login = client.post("/api/auth/login", json={"email": "scope.editor@example.com", "password": "ScopedPassword123!"})
    assert login.status_code == 200
    member_headers = auth(login.json()["token"])
    scoped = client.get("/api/snapshot", headers=member_headers).json()
    assert [f["id"] for f in scoped["data"]["settings"]["farms"]] == ["farm-a"]
    assert [b["id"] for b in scoped["data"]["batches"]] == ["batch-a"]
    assert [l["id"] for l in scoped["data"]["logs"]] == ["log-a"]

    malicious = scoped["data"]
    malicious["settings"]["farms"].append({"id": "farm-b", "name": "Trại B"})
    denied = client.put("/api/snapshot", headers=member_headers, json={"data": malicious, "expectedRevision": scoped["revision"]})
    assert denied.status_code == 403
    # The original farm B data must remain intact after the rejected write.
    remote_after = client.get("/api/snapshot", headers=owner_headers).json()["data"]
    assert any(b["id"] == "batch-b" for b in remote_after["batches"])
    assert any(l["id"] == "log-b" for l in remote_after["logs"])


def test_password_change_keeps_current_session_but_revokes_other_sessions(client: TestClient):
    account = register(client, "password.change@example.com")
    first_headers = auth(account["token"])
    second_login = client.post("/api/auth/login", json={"email": "password.change@example.com", "password": "SafePassword123!"})
    assert second_login.status_code == 200
    second_headers = auth(second_login.json()["token"])
    changed = client.post("/api/auth/change-password", headers=first_headers, json={
        "currentPassword": "SafePassword123!", "newPassword": "BrandNewPassword456!"
    })
    assert changed.status_code == 200
    assert client.get("/api/auth/me", headers=first_headers).status_code == 200
    assert client.get("/api/auth/me", headers=second_headers).status_code == 401
    assert client.post("/api/auth/login", json={"email": "password.change@example.com", "password": "BrandNewPassword456!"}).status_code == 200
    assert client.post("/api/auth/login", json={"email": "password.change@example.com", "password": "SafePassword123!"}).status_code == 401


def test_report_period_filter_and_export_are_in_frontend_asset(client: TestClient):
    response = client.get("/app.js")
    assert response.status_code == 200
    text = response.text
    assert 'id="reportFilterForm"' in text
    assert 'id="exportReportCsv"' in text
    assert "KẾT QUẢ GIAO DỊCH" in text
    assert "Chi tiết nhật ký thức ăn và biến động trong kỳ" in text
