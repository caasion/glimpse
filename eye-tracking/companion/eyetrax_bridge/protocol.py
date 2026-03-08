from __future__ import annotations

import json
from typing import Any


CLIENT_MESSAGE_TYPES = {
    "hello",
    "get_status",
    "start_calibration",
    "start_tracking",
    "stop_tracking",
    "load_model",
    "save_model",
    "ping",
    "start_collect_target",
    "fit_calibration_model",
}

SERVER_EVENT_TYPES = {
    "bridge_ready",
    "status",
    "calibration_started",
    "calibration_completed",
    "tracking_started",
    "tracking_stopped",
    "gaze_sample",
    "validation_target",
    "collect_target_done",
    "error",
    "pong",
}


class ProtocolError(ValueError):
    pass


def decode_message(raw: str) -> dict[str, Any]:
    try:
        message = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ProtocolError("message must be valid JSON") from exc

    if not isinstance(message, dict):
        raise ProtocolError("message must be an object")

    message_type = message.get("type")
    if not isinstance(message_type, str):
        raise ProtocolError("message.type must be a string")

    payload = message.get("payload", {})
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        raise ProtocolError("message.payload must be an object")

    return {
        "type": message_type,
        "payload": payload,
    }


def encode_message(message_type: str, payload: dict[str, Any] | None = None) -> str:
    return json.dumps(
        {
            "type": message_type,
            "payload": payload or {},
        }
    )
