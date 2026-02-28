import os
from typing import Iterable, Iterator

import requests
from flask import Flask, Response, jsonify, request


app = Flask(__name__)

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
        else:
            json_body = request.get_json(silent=True) or {}
            upstream = requests.post(
                upstream_url,
                headers={**headers, "Content-Type": "application/json"},
                json=json_body,
                stream=True,
                timeout=120,
            )
    except requests.RequestException as exc:
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

    if upstream.status_code >= 400:
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


if __name__ == "__main__":
    app.run(host=HOST, port=PORT, debug=True)
