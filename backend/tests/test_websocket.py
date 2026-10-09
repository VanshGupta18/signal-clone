import pytest
from starlette.websockets import WebSocketDisconnect

from tests.conftest import auth_header, login


def test_ws_rejects_missing_and_bad_token(client):
    for url in ["/ws", "/ws?token=garbage"]:
        with pytest.raises(WebSocketDisconnect) as exc:
            with client.websocket_connect(url) as ws:
                ws.receive_json()
        assert exc.value.code == 4401


def test_ws_rejects_logged_out_token(client):
    token = login(client)["token"]
    client.post("/api/auth/logout", headers=auth_header(token))
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/ws?token={token}") as ws:
            ws.receive_json()
    assert exc.value.code == 4401


def test_ws_identity_comes_from_token(client):
    res = login(client)
    with client.websocket_connect(f"/ws?token={res['token']}") as ws:
        ws.send_json({"hello": "world", "user_id": 999})  # client-claimed id is ignored
        reply = ws.receive_json()
    assert reply == {"type": "echo", "user_id": res["user"]["id"], "data": {"hello": "world", "user_id": 999}}
