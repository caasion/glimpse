from __future__ import annotations

import argparse
import asyncio
import logging
from typing import Any

import websockets

from . import __version__
from .protocol import CLIENT_MESSAGE_TYPES, ProtocolError, decode_message, encode_message
from .service import EyeTraxBridgeService


class EyeTraxBridgeServer:
    def __init__(self, host: str, port: int) -> None:
        self.host = host
        self.port = port
        self.clients: set[Any] = set()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.service = EyeTraxBridgeService(self.emit_from_thread)

    async def broadcast(self, message_type: str, payload: dict[str, Any] | None = None) -> None:
        if not self.clients:
            return

        wire_message = encode_message(message_type, payload)
        coroutines = [client.send(wire_message) for client in list(self.clients)]
        await asyncio.gather(*coroutines, return_exceptions=True)

    def emit_from_thread(self, message_type: str, payload: dict[str, Any] | None = None) -> None:
        if self.loop is None:
            return
        asyncio.run_coroutine_threadsafe(self.broadcast(message_type, payload), self.loop)

    async def handle_client(self, websocket: Any) -> None:
        self.clients.add(websocket)
        await websocket.send(
            encode_message(
                "bridge_ready",
                {
                    "version": __version__,
                    **self.service.status_payload(),
                },
            )
        )

        try:
            async for raw_message in websocket:
                try:
                    message = decode_message(raw_message)
                except ProtocolError as exc:
                    await websocket.send(
                        encode_message("error", {"scope": "protocol", "message": str(exc)})
                    )
                    continue

                await self.handle_message(websocket, message)
        except websockets.ConnectionClosed:
            logging.info("bridge client disconnected")
        finally:
            self.clients.discard(websocket)

    async def handle_message(
        self, websocket: Any, message: dict[str, Any]
    ) -> None:
        message_type = message["type"]
        payload = message["payload"]

        if message_type not in CLIENT_MESSAGE_TYPES:
            await websocket.send(
                encode_message(
                    "error",
                    {"scope": "protocol", "message": f"unknown message type: {message_type}"},
                )
            )
            return

        try:
            if message_type in {"hello", "get_status"}:
                await websocket.send(encode_message("status", self.service.status_payload()))
                return

            if message_type == "start_calibration":
                self.service.start_calibration(payload)
                return

            if message_type == "start_tracking":
                self.service.start_tracking(payload)
                return

            if message_type == "stop_tracking":
                self.service.stop_tracking()
                await websocket.send(encode_message("tracking_stopped", self.service.status_payload()))
                return

            if message_type == "load_model":
                self.service.load_model(payload)
                await websocket.send(encode_message("status", self.service.status_payload()))
                return

            if message_type == "save_model":
                await websocket.send(
                    encode_message(
                        "error",
                        {"scope": "protocol", "message": "save_model is not implemented in this prototype"},
                    )
                )
                return

            if message_type == "ping":
                await websocket.send(encode_message("pong", {"timestamp": payload.get("timestamp")}))
        except Exception as exc:  # pragma: no cover - manually exercised
            await websocket.send(
                encode_message("error", {"scope": "bridge", "message": str(exc)})
            )

    async def run(self) -> None:
        self.loop = asyncio.get_running_loop()
        async with websockets.serve(self.handle_client, self.host, self.port, max_size=None):
            logging.info("EyeTrax bridge listening on ws://%s:%s", self.host, self.port)
            await asyncio.Future()

    async def shutdown(self) -> None:
        self.service.shutdown()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="EyeTrax WebSocket bridge")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host")
    parser.add_argument("--port", type=int, default=8765, help="Bind port")
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="Logging level",
    )
    return parser.parse_args()


async def async_main() -> None:
    args = parse_args()
    logging.basicConfig(level=getattr(logging, args.log_level))
    server = EyeTraxBridgeServer(args.host, args.port)

    try:
        await server.run()
    finally:
        await server.shutdown()


def main() -> None:
    try:
        asyncio.run(async_main())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
