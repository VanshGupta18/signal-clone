from tests.conftest import auth_header, login


def test_wrong_otp_rejected(client):
    res = client.post("/api/auth/verify", json={"phone": "+15551234567", "otp": "000000"})
    assert res.status_code == 400


def test_invalid_phone_rejected(client):
    res = client.post("/api/auth/verify", json={"phone": "abc", "otp": "123456"})
    assert res.status_code == 422


def test_register_then_login_same_user(client):
    first = login(client, "+1 (555) 123-4567")
    second = login(client, "+15551234567")  # same number, different formatting
    assert first["is_new"] is True
    assert second["is_new"] is False
    assert first["user"]["id"] == second["user"]["id"]


def test_token_is_hashed_in_db(client, db):
    token = login(client)["token"]
    stored = db.execute("SELECT token_hash FROM sessions").fetchone()[0]
    assert stored != token


def test_me_requires_valid_token(client):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers=auth_header("garbage")).status_code == 401


def test_logout_invalidates_token(client):
    token = login(client)["token"]
    assert client.get("/api/me", headers=auth_header(token)).status_code == 200
    assert client.post("/api/auth/logout", headers=auth_header(token)).status_code == 204
    assert client.get("/api/me", headers=auth_header(token)).status_code == 401


def test_update_profile(client):
    token = login(client)["token"]
    avatar = "data:image/jpeg;base64,AAAA"
    res = client.patch("/api/me", headers=auth_header(token), json={"display_name": "  Alice ", "avatar_url": avatar})
    assert res.json()["display_name"] == "Alice"
    assert res.json()["avatar_url"] == avatar

    # Omitting avatar_url keeps it; sending null removes it.
    res = client.patch("/api/me", headers=auth_header(token), json={"display_name": "Al"})
    assert res.json()["avatar_url"] == avatar
    res = client.patch("/api/me", headers=auth_header(token), json={"avatar_url": None})
    assert res.json()["avatar_url"] is None


def test_profile_rejects_bad_input(client):
    token = login(client)["token"]
    assert client.patch("/api/me", headers=auth_header(token), json={"display_name": "   "}).status_code == 422
    bad_avatar = {"avatar_url": "javascript:alert(1)"}
    assert client.patch("/api/me", headers=auth_header(token), json=bad_avatar).status_code == 422


def test_request_code_validates_and_normalizes_phone(client):
    assert client.post("/api/auth/request-code", json={"phone": "98765 43210"}).json() == {"phone": "+9876543210"}
    assert client.post("/api/auth/request-code", json={"phone": "12345"}).status_code == 422
