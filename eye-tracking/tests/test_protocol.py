from __future__ import annotations

from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "companion"))

from eyetrax_bridge.protocol import ProtocolError, decode_message, encode_message


class ProtocolTests(unittest.TestCase):
    def test_encode_and_decode_round_trip(self) -> None:
        raw = encode_message("status", {"tracking": True, "screen_width": 1280})
        message = decode_message(raw)
        self.assertEqual(
            message,
            {
                "type": "status",
                "payload": {"tracking": True, "screen_width": 1280},
            },
        )

    def test_decode_message_rejects_non_object_payload(self) -> None:
        with self.assertRaises(ProtocolError):
            decode_message('{"type":"status","payload":[]}')

    def test_decode_message_requires_string_type(self) -> None:
        with self.assertRaises(ProtocolError):
            decode_message('{"type":123,"payload":{}}')


if __name__ == "__main__":
    unittest.main()
