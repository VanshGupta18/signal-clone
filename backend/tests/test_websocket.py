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


def test_ws_bad_events_get_error_and_socket_stays_open(client):
    token = login(client)["token"]
    with client.websocket_connect(f"/ws?token={token}") as ws:
        ws.send_text("not json")
        assert ws.receive_json()["type"] == "error"
        ws.send_json({"type": "nope", "client_id": "c1"})
        assert ws.receive_json() == {"type": "error", "client_id": "c1", "detail": "Unknown event type"}
        ws.send_json({"type": "message:send", "client_id": "c2"})  # missing fields
        assert ws.receive_json()["client_id"] == "c2"
