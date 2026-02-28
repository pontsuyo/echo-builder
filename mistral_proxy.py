import os
import logging
import subprocess
import time
import traceback
import tempfile
import sys
import json
from typing import Iterable, Iterator, Optional

from flask import g

import requests
from flask import Flask, Response, jsonify, request
from dotenv import load_dotenv


app = Flask(__name__)

# Load environment variables from .env file
load_dotenv()

LOG_LEVEL = os.getenv("MISTRAL_PROXY_LOG_LEVEL", "DEBUG").upper()
LOG_FORMAT = "[%(asctime)s] %(levelname)s %(name)s: %(message)s"
LOG_COLOR = os.getenv("MISTRAL_PROXY_NO_COLOR", "0").strip().lower() not in {
    "1",
    "true",
    "on",
    "yes",
}


def _is_tty_output() -> bool:
    return bool(getattr(sys.stdout, "isatty", lambda: False)()) and LOG_COLOR


class _ColorFormatter(logging.Formatter):
    _COLORS = {
        "DEBUG": "\033[90m",  # gray
        "INFO": "\033[36m",  # cyan
        "WARNING": "\033[33m",  # yellow
        "ERROR": "\033[31m",  # red
        "CRITICAL": "\033[91m",  # bright red
    }
    _RESET = "\033[0m"

    def format(self, record):
        message = super().format(record)
        if not _is_tty_output():
            return message
        color = self._COLORS.get(record.levelname, "")
        return f"{color}{message}{self._RESET}" if color else message


log_level = getattr(logging, LOG_LEVEL, logging.DEBUG)
root_logger = logging.getLogger()
root_logger.setLevel(log_level)
if not root_logger.handlers:
    handler = logging.StreamHandler()
    handler.setLevel(log_level)
    handler.setFormatter(_ColorFormatter(LOG_FORMAT, datefmt="%Y-%m-%d %H:%M:%S"))
    root_logger.addHandler(handler)
else:
    for handler in root_logger.handlers:
        if isinstance(handler, logging.StreamHandler):
            handler.setFormatter(_ColorFormatter(LOG_FORMAT, datefmt="%Y-%m-%d %H:%M:%S"))
logger = logging.getLogger("mistral_proxy")


API_BASE = os.getenv("MISTRAL_API_BASE", "https://api.mistral.ai").rstrip("/")
API_KEY = os.getenv("MISTRAL_API_KEY", "").strip()
HOST = os.getenv("MISTRAL_PROXY_HOST", "127.0.0.1")
PORT = int(os.getenv("MISTRAL_PROXY_PORT", "8001"))
CORS_ORIGIN = os.getenv("MISTRAL_PROXY_CORS_ORIGIN", "*")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "").strip()
ELEVENLABS_API_BASE = os.getenv("ELEVENLABS_API_BASE", "https://api.elevenlabs.io").rstrip("/")
ELEVENLABS_DEFAULT_VOICE_ID = os.getenv("ELEVENLABS_DEFAULT_VOICE_ID", "21m00Tcm4TlvDq8ikWAM").strip()
ELEVENLABS_DEFAULT_TTS_MODEL = os.getenv("ELEVENLABS_DEFAULT_TTS_MODEL", "eleven_multilingual_v2").strip()
ELEVENLABS_DEFAULT_TTS_FORMAT = os.getenv("ELEVENLABS_DEFAULT_TTS_FORMAT", "mp3_44100_128").strip()
FFMPEG_REENCODE_TO_WAV = os.getenv("MISTRAL_PROXY_REENCODE_TO_WAV", "").strip().lower() in {
    "1",
    "true",
    "on",
    "yes",
}
FFMPEG_BINARY = os.getenv("FFMPEG_BINARY", "ffmpeg")
FFMPEG_TARGET_RATE = os.getenv("MISTRAL_PROXY_REENCODE_RATE", "16000").strip()


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


def _extract_stt_text(payload: str) -> Optional[str]:
    if not isinstance(payload, str):
        return None
    if not payload.startswith("data:"):
        return None

    body = payload[len("data:") :].strip()
    if not body or body == "[DONE]":
        return None

    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return body if body.strip() else None

    if isinstance(data, str):
        return data
    if not isinstance(data, dict):
        return None

    for key in ("text", "delta", "payload"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value

    segment = data.get("segment")
    if isinstance(segment, dict):
        segment_text = segment.get("text")
        if isinstance(segment_text, str) and segment_text.strip():
            return segment_text

    return None


def _extract_stt_text_from_json(body: str) -> Optional[str]:
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return None

    if isinstance(data, str):
        return data
    if not isinstance(data, dict):
        return None

    for key in ("text", "transcript", "payload"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value

    if isinstance(data.get("segment"), dict):
        segment_text = data["segment"].get("text")
        if isinstance(segment_text, str) and segment_text.strip():
            return segment_text

    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, dict):
            for key in ("text", "delta"):
                value = first.get(key)
                if isinstance(value, str) and value.strip():
                    return value

    return None


def _iter_stt_event_chunks(upstream: requests.Response, request_id: str, path: str) -> Iterator[bytes]:
    for line in upstream.iter_lines(decode_unicode=True):
        if line is None:
            continue
        text = _extract_stt_text(line)
        if text and path == "/v1/audio/transcriptions":
            logger.info("STT_STREAM id=%s path=%s text=%s", request_id, path, _short(text))
        yield (line + "\n").encode("utf-8")


def _ext_from_mime_or_name(file_name: str, mimetype: str) -> str:
    lower_name = (file_name or "").lower()
    lower_mime = (mimetype or "").lower()
    if ".mp4" in lower_name:
        return ".m4a"
    if ".webm" in lower_name:
        return ".webm"
    if ".m4a" in lower_name:
        return ".m4a"
    if ".ogg" in lower_name:
        return ".ogg"

    if "audio/webm" in lower_mime:
        return ".webm"
    if "audio/ogg" in lower_mime:
        return ".ogg"
    if "audio/mp4" in lower_mime or "audio/m4a" in lower_mime:
        return ".m4a"
    if "audio/wav" in lower_mime:
        return ".wav"
    return ".bin"


def _maybe_reencode_audio_chunk(file_name: str, mimetype: str, raw: bytes):
    if not FFMPEG_REENCODE_TO_WAV or not raw:
        return raw, file_name, mimetype

    out_name = file_name or "chunk.bin"
    source_ext = _ext_from_mime_or_name(file_name or out_name, mimetype or "")
    with tempfile.NamedTemporaryFile(suffix=source_ext, delete=False) as source_file:
        source_path = source_file.name
        source_file.write(raw)

    output_path = f"{source_path}.wav"
    try:
        logger.debug(
            "TRANSCODE id=%s start file=%s size=%s mime=%s source_ext=%s",
            g.request_id,
            out_name,
            len(raw),
            mimetype or "unknown",
            source_ext,
        )
        subprocess.run(
            [
                FFMPEG_BINARY,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                source_path,
                "-acodec",
                "pcm_s16le",
                "-ac",
                "1",
                "-ar",
                FFMPEG_TARGET_RATE,
                "-f",
                "wav",
                output_path,
            ],
            check=True,
            timeout=20,
            capture_output=True,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError) as err:
        message = str(err)
        if not message:
            message = err.__class__.__name__
        logger.warning(
            "TRANSCODE id=%s failed (%s) fallback original",
            g.request_id,
            message,
        )
        try:
            os.unlink(source_path)
        except Exception:
            pass
        try:
            os.unlink(output_path)
        except Exception:
            pass
        return raw, file_name, mimetype

    with open(output_path, "rb") as converted:
        converted_bytes = converted.read()
    try:
        os.unlink(source_path)
        os.unlink(output_path)
    except Exception:
        pass
    return converted_bytes, os.path.splitext(out_name)[0] + ".wav", "audio/wav"


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


def _build_voice_settings(settings) -> Optional[dict]:
    if not isinstance(settings, dict):
        return None

    sanitized = {}
    for key, value in settings.items():
        if value is None:
            continue
        sanitized[str(key)] = value

    return sanitized


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

            uploaded_name = file_obj.filename or "chunk.bin"
            uploaded_type = file_obj.mimetype or "application/octet-stream"
            file_body = file_obj.stream.read()
            if request.path == "/v1/audio/transcriptions":
                file_body, uploaded_name, uploaded_type = _maybe_reencode_audio_chunk(
                    uploaded_name,
                    uploaded_type,
                    file_body,
                )

            files = {
                "file": (
                    uploaded_name,
                    file_body,
                    uploaded_type,
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
                _iter_stt_event_chunks(
                    upstream,
                    g.request_id,
                    request.path,
                ),
                status=upstream.status_code,
                content_type=content_type,
            )
        )

    if content_type and "application/json" in content_type:
        if request.path == "/v1/audio/transcriptions":
            stt_text = _extract_stt_text_from_json(upstream.text)
            if stt_text:
                logger.info("STT_RESULT id=%s path=%s text=%s", g.request_id, request.path, _short(stt_text))
        logger.debug(
            "UPSTREAM id=%s response_body=%s",
            g.request_id,
            _short(upstream.text),
        )
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


@app.route("/v1/text-to-speech", methods=["POST", "OPTIONS"])
def text_to_speech() -> Response:
    if request.method == "OPTIONS":
        return add_cors_headers(Response("", status=204))

    if not ELEVENLABS_API_KEY:
        logger.error("REQ id=%s missing ELEVENLABS_API_KEY", g.request_id)
        response = jsonify({"error": {"message": "ELEVENLABS_API_KEY is not set on proxy server"}})
        response.status_code = 500
        return add_cors_headers(response)

    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        payload = {}

    text = str(payload.get("text", "")).strip()
    if not text:
        response = jsonify({"error": {"message": "text is required"}})
        response.status_code = 400
        return add_cors_headers(response)

    voice_id = str(payload.get("voice_id", "")).strip() or ELEVENLABS_DEFAULT_VOICE_ID
    if not voice_id:
        response = jsonify({"error": {"message": "voice_id is required"}})
        response.status_code = 400
        return add_cors_headers(response)

    model_id = str(payload.get("model_id", "")).strip() or ELEVENLABS_DEFAULT_TTS_MODEL
    output_format = str(payload.get("output_format", "")).strip() or ELEVENLABS_DEFAULT_TTS_FORMAT
    voice_settings = _build_voice_settings(payload.get("voice_settings"))

    upstream_url = f"{ELEVENLABS_API_BASE}/v1/text-to-speech/{voice_id}"
    body = {
        "text": text,
    }
    if model_id:
        body["model_id"] = model_id
    if output_format:
        body["output_format"] = output_format
    if voice_settings:
        body["voice_settings"] = voice_settings
    if payload.get("optimize_streaming_latency") is not None:
        body["optimize_streaming_latency"] = payload.get("optimize_streaming_latency")

    try:
        upstream = requests.post(
            upstream_url,
            headers={
                "xi-api-key": ELEVENLABS_API_KEY,
                "Content-Type": "application/json",
            },
            json=body,
            stream=True,
            timeout=120,
        )
    except requests.RequestException as exc:
        _log_upstream_error(exc, request.path, upstream_url)
        response = jsonify({
            "error": {
                "message": f"Failed to request ElevenLabs API: {exc}",
            }
        })
        response.status_code = 502
        return add_cors_headers(response)

    content_type = upstream.headers.get("content-type", "")
    logger.debug(
        "ELEVENLABS_UPSTREAM id=%s status=%s content_type=%s",
        g.request_id,
        upstream.status_code,
        content_type,
    )

    if upstream.status_code >= 400:
        logger.error(
            "ELEVENLABS_UPSTREAM ERROR id=%s status=%s body=%s",
            g.request_id,
            upstream.status_code,
            _short(upstream.text),
        )
        response = Response(
            upstream.text,
            status=upstream.status_code,
            content_type=content_type or "text/plain; charset=utf-8",
        )
        return add_cors_headers(response)

    return add_cors_headers(
        Response(
            iter_response_chunks(upstream),
            status=upstream.status_code,
            content_type=content_type or "audio/mpeg",
        )
    )


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
