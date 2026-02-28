import os
import logging
import time
import traceback
from typing import Iterable, Iterator

from flask import g

import requests
from flask import Flask, Response, jsonify, request


app = Flask(__name__)

LOG_LEVEL = os.getenv("MISTRAL_PROXY_LOG_LEVEL", "DEBUG").upper()
LOG_FORMAT = "[%(asctime)s] %(levelname)s %(name)s: %(message)s"
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.DEBUG),
    format=LOG_FORMAT,
)
logger = logging.getLogger("mistral_proxy")


API_BASE = os.getenv("MISTRAL_API_BASE", "https://api.mistral.ai").rstrip("/")
API_KEY = os.getenv("MISTRAL_API_KEY", "").strip()
HOST = os.getenv("MISTRAL_PROXY_HOST", "127.0.0.1")
PORT = int(os.getenv("MISTRAL_PROXY_PORT", "8001"))
CORS_ORIGIN = os.getenv("MISTRAL_PROXY_CORS_ORIGIN", "*")


def build_headers() -> dict:
    headers = {}
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"
    return headers


def add_cors_headers(resp):
    resp.headers["Access-Control-Allow-Origin"] = CORS_ORIGIN
    resp.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    return resp


def _short(value, max_len=320):
    if value is None:
        return ""
    text = str(value)
    if len(text) <= max_len:
        return text
    return f"{text[: max_len - 1]}…(+{len(text) - max_len} chars)"


def _shorten_headers(headers):
    copied = {}
    for key, value in headers.items():
        if key.lower() == "authorization":
            copied[key] = "***"
        else:
            copied[key] = _short(value)
    return copied


@app.before_request
def log_request():
    g.request_id = request.headers.get("X-Request-ID", request.remote_addr or "-")
    g.start_at = time.monotonic()
    logger.debug(
        "REQ id=%s method=%s path=%s content_type=%s content_length=%s headers=%s",
        g.request_id,
        request.method,
        request.path,
        request.content_type,
        request.content_length,
        _shorten_headers(request.headers),
    )


@app.after_request
def log_response(response):
    elapsed = time.monotonic() - getattr(g, "start_at", time.monotonic())
    logger.debug(
        "RES id=%s status=%s elapsed_ms=%s path=%s",
        getattr(g, "request_id", "-"),
        response.status_code,
        int(elapsed * 1000),
        request.path,
    )
    return response


def _log_upstream_error(exc: Exception, path: str, upstream_url: str):
    logger.error("UPSTREAM ERROR path=%s url=%s err=%s", path, upstream_url, exc)
    logger.debug("TRACEBACK: %s", traceback.format_exc())


@app.after_request
def ensure_cors(response):
    return add_cors_headers(response)


def iter_response_chunks(upstream: requests.Response) -> Iterator[bytes]:
    for chunk in upstream.iter_content(chunk_size=16 * 1024):
        if chunk:
            yield chunk


def proxy_request(path: str) -> Response:
    upstream_url = f"{API_BASE}{path}"

    if request.method == "OPTIONS":
        return add_cors_headers(Response("", status=204))

    if not API_KEY:
        logger.error("REQ id=%s missing MISTRAL_API_KEY", g.request_id)
        err = {"error": {"message": "MISTRAL_API_KEY is not set on proxy server"}}
        response = jsonify(err)
        response.status_code = 500
        return add_cors_headers(response)

    headers = build_headers()

    upstream = None
    try:
        if request.content_type and "multipart/form-data" in request.content_type.lower():
            data = request.form.to_dict(flat=True)
            file_obj = request.files.get("file")
            if not file_obj:
                logger.warning("REQ id=%s missing audio file", g.request_id)
                response = jsonify({"error": {"message": "audio file is required"}})
                response.status_code = 400
                return add_cors_headers(response)

            files = {
                "file": (
                    file_obj.filename,
                    file_obj.stream.read(),
                    file_obj.mimetype or "application/octet-stream",
                )
            }
            upstream = requests.post(
                upstream_url,
                headers=headers,
                data=data,
                files=files,
                stream=True,
                timeout=120,
            )
            logger.debug(
                "REQ id=%s proxied multipart file=%s fields=%s",
                g.request_id,
                file_obj.filename,
                list(data.keys()),
            )
        else:
            json_body = request.get_json(silent=True) or {}
            logger.debug(
                "REQ id=%s proxied json keys=%s payload=%s",
                g.request_id,
                list(json_body.keys()) if isinstance(json_body, dict) else type(json_body).__name__,
                _short(json_body),
            )
            upstream = requests.post(
                upstream_url,
                headers={**headers, "Content-Type": "application/json"},
                json=json_body,
                stream=True,
                timeout=120,
            )
    except requests.RequestException as exc:
        _log_upstream_error(exc, request.path, upstream_url)
        response = jsonify(
            {
                "error": {
                    "message": f"Failed to request Mistral API: {exc}",
                }
            }
        )
        response.status_code = 502
        return add_cors_headers(response)

    content_type = upstream.headers.get("content-type", "")
    logger.debug(
        "UPSTREAM id=%s status=%s content_type=%s",
        g.request_id,
        upstream.status_code,
        content_type,
    )

    if upstream.status_code >= 400:
        logger.error(
            "UPSTREAM ERROR id=%s status=%s body=%s",
            g.request_id,
            upstream.status_code,
            _short(upstream.text),
        )
        body = upstream.text
        resp = Response(
            body,
            status=upstream.status_code,
            content_type=content_type or "text/plain; charset=utf-8",
        )
        return add_cors_headers(resp)

    if content_type and "text/event-stream" in content_type:
        return add_cors_headers(
            Response(
                iter_response_chunks(upstream),
                status=upstream.status_code,
                content_type=content_type,
            )
        )

    if content_type and "application/json" in content_type:
        return add_cors_headers(
            Response(upstream.text, status=upstream.status_code, content_type=content_type)
        )

    return add_cors_headers(
        Response(
            upstream.content,
            status=upstream.status_code,
            content_type=content_type or "application/octet-stream",
        )
    )


@app.route("/v1/chat/completions", methods=["POST", "OPTIONS"])
def chat_completions() -> Response:
    return proxy_request("/v1/chat/completions")


@app.route("/v1/audio/transcriptions", methods=["POST", "OPTIONS"])
def transcriptions() -> Response:
    return proxy_request("/v1/audio/transcriptions")


@app.errorhandler(Exception)
def handle_unexpected_error(error):
    logger.exception(
        "UNHANDLED ERROR id=%s path=%s error=%s",
        getattr(g, "request_id", "-"),
        request.path,
        error,
    )
    response = jsonify({"error": {"message": f"internal error: {error}"}})
    response.status_code = 500
    return add_cors_headers(response)


if __name__ == "__main__":
    app.run(host=HOST, port=PORT, debug=True)
