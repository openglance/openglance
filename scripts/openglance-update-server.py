#!/usr/bin/env python3
import argparse
import base64
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
import gzip
import hashlib
import html
import json
import os
import posixpath
import re
import secrets
import shutil
import sys
import threading
import time
from http import HTTPStatus
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlencode, urlparse

# Event semantics and allowed analytical claims are defined by
# docs/app-usage-analytics-spec.md. Update the spec before changing this contract.


HANDOFF_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{20,64}")
HANDOFF_TTL_SECONDS = 600
# The hosted handoff must reach both Git Leaf 1.x and OpenGlance. Both
# generations register this protocol, while OpenGlance also registers the
# canonical openglance scheme.
HOSTED_HANDOFF_PROTOCOL = "git-leaf"
# 64px favicon derived from assets/icons/openglance.png; embedded for single-file deployment.
LINK_ICON_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAA"
    "dTAAAOpgAAA6mAAAF3CculE8AAAARGVYSWZNTQAqAAAACAABh2kABAAAAAEAAAAaAAAAAAADoAEAAwAAAAEAAQAAoAIABAAAAAEA"
    "AABAoAMABAAAAAEAAABAAAAAAEZRQrAAAAHNaVRYdFhNTDpjb20uYWRvYmUueG1wAAAAAAA8eDp4bXBtZXRhIHhtbG5zOng9ImFk"
    "b2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJYTVAgQ29yZSA2LjAuMCI+CiAgIDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53"
    "My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+CiAgICAgIDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiCiAgICAg"
    "ICAgICAgIHhtbG5zOmV4aWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20vZXhpZi8xLjAvIj4KICAgICAgICAgPGV4aWY6Q29sb3JTcGFj"
    "ZT4xPC9leGlmOkNvbG9yU3BhY2U+CiAgICAgICAgIDxleGlmOlBpeGVsWERpbWVuc2lvbj4xMDI0PC9leGlmOlBpeGVsWERpbWVu"
    "c2lvbj4KICAgICAgICAgPGV4aWY6UGl4ZWxZRGltZW5zaW9uPjEwMjQ8L2V4aWY6UGl4ZWxZRGltZW5zaW9uPgogICAgICA8L3Jk"
    "ZjpEZXNjcmlwdGlvbj4KICAgPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4Kwe07qQAAFflJREFUeAGtWwmUVdWVPe/9X1VQxSyCA4kT"
    "KjPGtApOsZVJDYlpB5yNJqaDNkog6krotHFYEYcESWIrHYeILWmNGs0iCIJZ2CZKYlDEBiQqyIwMxSBWAfWH3vvc4d33/q+yWN13"
    "1X/33HPOPdOd73sVSVvprLPyNTs6Di6VoqEipXEi0ZiEPTKgzUBLSISiTDlNPfBSuZypY8se7QHwleeKxM/Ecfndlu7N78nChYVM"
    "ZV+sbmWf4R3jbl2uiST+lkTlEyTK5SEUf06JraZZRkSrjmf4vAmtAU5Xhu5tcHjaFcAKQhftKBcLUo6WlKX0WGnn7idl/ZvNjtPl"
    "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"
)
SHARE_PREVIEW_TITLE_MAX_LENGTH = 100
SHARE_PREVIEW_SNIPPET_MAX_LENGTH = 200
TELEMETRY_MAX_BODY_BYTES = 64 * 1024
TELEMETRY_MAX_BATCH_EVENTS = 100
TELEMETRY_DIRECTORY_MODE = 0o750
TELEMETRY_FILE_MODE = 0o640
TELEMETRY_MAINTENANCE_INTERVAL_SECONDS = 6 * 60 * 60
TELEMETRY_STRICT_UPDATE_CONTRACT_VERSION = "1.10.0"
SEMVER_PATTERN = re.compile(
    r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
)
ISO_TIMESTAMP_PATTERN = re.compile(
    r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})"
)
TELEMETRY_EVENT_NAMES = {
    "git_leaf.installation.observed",
    "git_leaf.update.state_changed",
    "git_leaf.daily.summary",
}
TELEMETRY_FEATURE_DIMENSIONS = {
    "navigation.file_search": {},
    "navigation.document_search": {},
    "navigation.frontmatter_filter": {
        "action": {"apply", "clear"},
        "filter_count_bucket": {"1", "2_3", "4_plus"},
    },
    "navigation.worktree_switch": {"result": {"success", "cancel", "error"}},
    "navigation.deep_link": {
        "type": {"repository", "exact_worktree"},
        "result": {"success", "cancel", "error"},
        "failure_reason": {
            "repository_not_known", "worktree_not_found",
            "repository_selection_invalid", "repository_identity_mismatch",
            "repository_open_failed", "main_worktree_check_failed",
            "main_worktree_unavailable", "primary_not_main", "fetch_failed",
            "revision_missing", "main_ahead", "main_diverged", "sync_failed",
            "safe_update_failed", "document_open_failed", "unknown",
        },
    },
    "editing.activity": {
        "mode": {"source", "live"},
    },
    "editing.slash_command": {
        "command_category": {"markdown", "mdx_component", "media"},
    },
    "editing.frontmatter": {
        "action": {"add", "edit", "delete"},
        "result": {"success", "cancel", "error"},
    },
    "editing.image_paste": {"result": {"success", "cancel", "error"}},
    "editing.markdown_to_mdx": {"result": {"success", "cancel", "error"}},
    "output.pdf_export": {"result": {"success", "cancel", "error"}},
    "git.sync": {
        "strategy": {"guarded_live_v1"},
        "result": {"success", "cancel", "error"},
        "file_count_bucket": {"1", "2_5", "6_20", "21_plus"},
        "drift_kind": {"none", "content_changed", "head_changed", "post_commit_changed"},
        "retry_bucket": {"0", "1", "2_plus"},
        "duration_bucket": {"under_1s", "1_3s", "3_10s", "over_10s"},
        "error_code": {
            "identity_missing", "origin_missing", "conflict", "nothing_selected",
            "commit_failed", "workspace_changed", "head_changed", "pull_failed",
            "push_failed", "unknown",
        },
    },
    "github.open": {"result": {"success", "cancel", "error"}},
    "line_reference.copy": {"line_count_bucket": {"1", "2_5", "6_plus"}},
}


class HandoffRegistry:
    def __init__(self, ttl_seconds=HANDOFF_TTL_SECONDS):
        self.ttl_seconds = ttl_seconds
        self.entries = {}
        self.lock = threading.Lock()

    def create(self):
        with self.lock:
            self._remove_expired()
            handoff_id = secrets.token_urlsafe(24)
            self.entries[handoff_id] = {
                "created_at": time.monotonic(),
                "state": "pending",
            }
            return handoff_id

    def confirm(self, handoff_id):
        with self.lock:
            self._remove_expired()
            entry = self.entries.get(handoff_id)
            if not entry:
                return False
            entry["state"] = "opened"
            return True

    def opened(self, handoff_id):
        with self.lock:
            self._remove_expired()
            entry = self.entries.get(handoff_id)
            return bool(entry and entry["state"] == "opened")

    def state(self, handoff_id):
        with self.lock:
            self._remove_expired()
            entry = self.entries.get(handoff_id)
            return entry["state"] if entry else "expired"

    def update(self, handoff_id, state):
        if state not in {"received", "cancelled", "failed"}:
            return False
        with self.lock:
            self._remove_expired()
            entry = self.entries.get(handoff_id)
            if not entry:
                return False
            entry["state"] = state
            return True

    def _remove_expired(self):
        cutoff = time.monotonic() - self.ttl_seconds
        expired = [
            handoff_id
            for handoff_id, entry in self.entries.items()
            if entry["created_at"] < cutoff
        ]
        for handoff_id in expired:
            self.entries.pop(handoff_id, None)


class TelemetryRateLimiter:
    def __init__(self, limit=600, window_seconds=60):
        self.limit = limit
        self.window_seconds = window_seconds
        self.entries = {}
        self.lock = threading.Lock()

    def allow(self, source, events):
        now = time.monotonic()
        with self.lock:
            self.entries = {
                key: entry
                for key, entry in self.entries.items()
                if now - entry[0] < self.window_seconds
            }
            requested = {}
            for event in events:
                key = (source, event["install_id"])
                requested[key] = requested.get(key, 0) + 1
            for key, count in requested.items():
                _started_at, current = self.entries.get(key, (now, 0))
                if current + count > self.limit:
                    return False
            for key, count in requested.items():
                started_at, current = self.entries.get(key, (now, 0))
                self.entries[key] = (started_at, current + count)
            return True


class TelemetryLogStore:
    def __init__(self, root, collection="events", write_function=None):
        self.root = Path(root)
        self.collection = collection
        self.lock = threading.Lock()
        self.last_maintenance_date = None
        self.write_function = write_function or os.write

    def append(self, events, received_at):
        payload = "".join(
            json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n"
            for event in events
        ).encode("utf-8")
        if not payload:
            raise ValueError("Telemetry batches must contain at least one event.")
        target = (
            self.root
            / self.collection
            / received_at.strftime("%Y")
            / received_at.strftime("%m")
            / f"{received_at.strftime('%d')}.jsonl"
        )
        with self.lock:
            self._prepare_log_directory(target.parent)
            created = not target.exists()
            flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND
            flags |= getattr(os, "O_CLOEXEC", 0)
            flags |= getattr(os, "O_NOFOLLOW", 0)
            descriptor = os.open(target, flags, TELEMETRY_FILE_MODE)
            original_size = os.fstat(descriptor).st_size
            try:
                set_telemetry_file_mode(target, descriptor)
                self._write_all(descriptor, payload)
                os.fsync(descriptor)
            except BaseException:
                try:
                    os.ftruncate(descriptor, original_size)
                    os.fsync(descriptor)
                except OSError:
                    pass
                os.close(descriptor)
                descriptor = None
                if created:
                    target.unlink(missing_ok=True)
                raise
            finally:
                if descriptor is not None:
                    os.close(descriptor)

    def maintain(self, current_date=None, force=False):
        current_date = current_date or datetime.now(timezone.utc).date()
        if not isinstance(current_date, date):
            raise TypeError("current_date must be a date")
        with self.lock:
            if not force and self.last_maintenance_date == current_date:
                return {"skipped": True, "compressed": 0, "deleted": 0, "invalid_gzip": 0}
            result = self._maintain(current_date)
            self.last_maintenance_date = current_date
            return {"skipped": False, **result}

    def _write_all(self, descriptor, payload):
        remaining = memoryview(payload)
        while remaining:
            written = self.write_function(descriptor, remaining)
            if not isinstance(written, int) or written <= 0 or written > len(remaining):
                raise OSError("Telemetry batch write did not make progress.")
            remaining = remaining[written:]

    def _prepare_log_directory(self, target):
        directories = [self.root, self.root / self.collection]
        relative = target.relative_to(self.root / self.collection)
        current = self.root / self.collection
        for part in relative.parts:
            current /= part
            directories.append(current)
        for directory in directories:
            directory.mkdir(mode=TELEMETRY_DIRECTORY_MODE, parents=True, exist_ok=True)
            directory.chmod(TELEMETRY_DIRECTORY_MODE)

    def _maintain(self, current_date):
        collection_root = self.root / self.collection
        result = {"compressed": 0, "deleted": 0, "invalid_gzip": 0}
        if not collection_root.is_dir():
            return result
        self.root.chmod(TELEMETRY_DIRECTORY_MODE)
        collection_root.chmod(TELEMETRY_DIRECTORY_MODE)
        for target in sorted(collection_root.glob("*/*/*.jsonl*")):
            log_date = telemetry_log_date(collection_root, target)
            if not log_date:
                continue
            target.parent.parent.chmod(TELEMETRY_DIRECTORY_MODE)
            target.parent.chmod(TELEMETRY_DIRECTORY_MODE)
            target.chmod(TELEMETRY_FILE_MODE)
            if add_calendar_months(log_date, 12) <= current_date:
                target.unlink(missing_ok=True)
                result["deleted"] += 1
                continue
            age_days = (current_date - log_date).days
            if age_days < 7 or target.name.endswith(".gz"):
                continue
            compressed = target.with_name(f"{target.name}.gz")
            if compressed.exists():
                compressed.chmod(TELEMETRY_FILE_MODE)
                if not valid_gzip_file(compressed):
                    result["invalid_gzip"] += 1
                    continue
            else:
                compress_log_file(target, compressed)
            target.unlink(missing_ok=True)
            result["compressed"] += 1
        return result


class TelemetryMaintenanceRunner:
    def __init__(self, stores, interval_seconds=TELEMETRY_MAINTENANCE_INTERVAL_SECONDS):
        self.stores = tuple(stores)
        self.interval_seconds = interval_seconds
        self.stop_event = threading.Event()
        self.thread = None

    def run_once(self, current_date=None, force=False):
        results = {}
        for store in self.stores:
            try:
                results[store.collection] = store.maintain(current_date, force=force)
            except OSError as error:
                results[store.collection] = {"error": type(error).__name__}
                print(
                    f"TELEMETRY_MAINTENANCE_ERROR collection={store.collection} error={type(error).__name__}",
                    file=sys.stderr,
                    flush=True,
                )
        return results

    def start(self):
        if self.thread is not None:
            return
        self.run_once()
        self.thread = threading.Thread(target=self._run, name="telemetry-maintenance", daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread is not None:
            self.thread.join(timeout=2)

    def _run(self):
        while not self.stop_event.wait(self.interval_seconds):
            self.run_once()


class DistributionDownloadLogStore(TelemetryLogStore):
    def __init__(self, root):
        super().__init__(root, collection="downloads")

    def append_download(self, download, received_at):
        self.append([{
            "schema_version": 1,
            "download_id": secrets.token_urlsafe(24),
            "event_name": "git_leaf.distribution.downloaded",
            "occurred_at": received_at.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            **download,
        }], received_at)


def telemetry_log_date(events_root, target):
    try:
        relative = target.relative_to(events_root)
        year, month, filename = relative.parts
        match = re.fullmatch(r"(\d{2})\.jsonl(?:\.gz)?", filename)
        if not match:
            return None
        return date(int(year), int(month), int(match.group(1)))
    except (ValueError, TypeError):
        return None


def add_calendar_months(value, months):
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, monthrange(year, month)[1])
    return date(year, month, day)


def compress_log_file(source, target):
    temporary = target.with_name(f".{target.name}.tmp-{secrets.token_hex(8)}")
    try:
        with temporary.open("xb") as raw_output:
            set_telemetry_file_mode(temporary, raw_output.fileno())
            with source.open("rb") as raw_input, gzip.GzipFile(
                    filename="", mode="wb", fileobj=raw_output, mtime=0,
            ) as compressed_output:
                shutil.copyfileobj(raw_input, compressed_output)
            raw_output.flush()
            os.fsync(raw_output.fileno())
        os.replace(temporary, target)
        target.chmod(TELEMETRY_FILE_MODE)
    finally:
        temporary.unlink(missing_ok=True)


def set_telemetry_file_mode(target, descriptor=None):
    if descriptor is not None and hasattr(os, "fchmod"):
        os.fchmod(descriptor, TELEMETRY_FILE_MODE)
        return
    Path(target).chmod(TELEMETRY_FILE_MODE)


def valid_gzip_file(target):
    try:
        with gzip.open(target, "rb") as source:
            while source.read(1024 * 1024):
                pass
        return True
    except (OSError, EOFError):
        return False


class OpenGlanceUpdateHandler(SimpleHTTPRequestHandler):
    server_version = "OpenGlanceUpdates/1.0"

    def do_GET(self):
        if self._handle_link_icon(send_body=True):
            return
        if self._handle_share_status():
            return
        if self._handle_open_status():
            return
        if self._handle_download_page(send_body=True):
            return
        if self._handle_share_page(send_body=True):
            return
        if self._handle_open_page(send_body=True):
            return
        if self._handle_mac_release_feed(send_body=True):
            return
        download = distribution_download_record(self.directory, self.path)
        super().do_GET()
        if download:
            try:
                self.server.download_log_store.append_download(
                    download,
                    datetime.now(timezone.utc),
                )
            except OSError:
                # Product analytics must never make an otherwise successful download fail.
                pass

    def do_POST(self):
        if self._handle_telemetry_events():
            return
        if self._handle_open_confirm():
            return
        if self._handle_share_state():
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_HEAD(self):
        if self._handle_link_icon(send_body=False):
            return
        if self._handle_download_page(send_body=False):
            return
        if self._handle_share_page(send_body=False):
            return
        if self._handle_open_page(send_body=False):
            return
        if self._handle_mac_release_feed(send_body=False):
            return
        super().do_HEAD()

    def end_headers(self):
        parsed_path = urlparse(self.path).path
        if parsed_path.endswith(".json") or "/releases/" in parsed_path:
            self.send_header("Cache-Control", "no-store")
        elif re.search(r"\.(zip|dmg|blockmap)$", parsed_path):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        super().end_headers()

    def _handle_download_page(self, send_body):
        parsed = urlparse(self.path)
        if parsed.path != "/download":
            return False

        language = download_page_language(
            parse_qs(parsed.query, keep_blank_values=True),
            self.headers.get("Accept-Language", ""),
        )
        body = download_page_html(
            language,
            latest_public_downloads(self.directory),
        ).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Language", language)
        self.send_header("Vary", "Accept-Language")
        self.send_header("Cache-Control", "no-store")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'; "
            "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        )
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if send_body:
            self.wfile.write(body)
        return True

    def _handle_link_icon(self, send_body):
        if urlparse(self.path).path != "/open/icon.png":
            return False
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(LINK_ICON_PNG)))
        self.send_header("Cache-Control", "public, max-age=86400")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if send_body:
            self.wfile.write(LINK_ICON_PNG)
        return True

    def _handle_open_page(self, send_body):
        parsed = urlparse(self.path)
        if parsed.path != "/open":
            return False

        query = parse_qs(parsed.query, keep_blank_values=True)
        repository_values = query.get("repo", [])
        path_values = query.get("path", [])
        worktree_values = query.get("worktree", [])
        title_values = query.get("title", [])
        if len(title_values) > 1:
            self._send_open_error(send_body)
            return True
        preview_title = normalize_share_preview_text(
            title_values[0] if title_values else "", SHARE_PREVIEW_TITLE_MAX_LENGTH,
        )
        if title_values and not preview_title:
            self._send_open_error(send_body)
            return True
        if len(repository_values) > 1 or len(path_values) > 1 or len(worktree_values) > 1:
            self._send_open_error(send_body)
            return True

        repository = normalize_repository_identity(repository_values[0] if repository_values else "")
        document_path = normalize_document_path(path_values[0] if path_values else "")
        worktree = normalize_worktree_id(worktree_values[0] if worktree_values else "")
        requested_repository = bool(repository_values)
        requested_path = bool(path_values)
        requested_worktree = bool(worktree_values)

        if requested_repository != requested_path:
            self._send_open_error(send_body)
            return True
        if requested_repository and (not repository or not document_path):
            self._send_open_error(send_body)
            return True
        if requested_worktree and (not requested_repository or not worktree):
            self._send_open_error(send_body)
            return True

        handoff_id = self.server.handoffs.create()
        deep_link_params = {}
        if repository:
            deep_link_params.update({"repo": repository, "path": document_path})
        if worktree:
            deep_link_params["worktree"] = worktree
        deep_link_params["handoff"] = handoff_id
        deep_link_host = "open-worktree" if worktree else "open"
        deep_link = f"{HOSTED_HANDOFF_PROTOCOL}://{deep_link_host}?" + urlencode(deep_link_params)

        if repository:
            title = preview_title or posixpath.basename(document_path)
            detail = f"{repository} · {document_path}"
        else:
            title = "正在启动 OpenGlance"
            detail = "这个链接只启动或聚焦应用，不会切换当前仓库或文档。"
        body = open_page_html(
            title,
            detail,
            deep_link,
            handoff_id,
            preview_title=title,
            preview_description=detail + (" · 在本机指定工作目录打开" if worktree else " · 在 OpenGlance 中打开") if repository else detail,
        ).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self._send_open_headers(len(body))
        self.end_headers()
        if send_body:
            self.wfile.write(body)
        return True

    def _handle_share_page(self, send_body):
        parsed = urlparse(self.path)
        if parsed.path != "/share":
            return False

        query = parse_qs(parsed.query, keep_blank_values=True)
        allowed_keys = {"v", "repo", "path", "rev", "title", "snippet", "lk_jump_to_browser"}
        if any(key not in allowed_keys for key in query):
            self._send_share_error(send_body)
            return True
        values = {key: query.get(key, []) for key in ("v", "repo", "path", "rev")}
        if any(len(items) != 1 for items in values.values()):
            self._send_share_error(send_body)
            return True
        if len(query.get("lk_jump_to_browser", [])) > 1:
            self._send_share_error(send_body)
            return True
        preview_title_values = query.get("title", [])
        preview_snippet_values = query.get("snippet", [])
        if len(preview_title_values) > 1 or len(preview_snippet_values) > 1:
            self._send_share_error(send_body)
            return True

        version = values["v"][0]
        repository = normalize_repository_identity(values["repo"][0])
        document_path = normalize_document_path(values["path"][0])
        revision = normalize_git_revision(values["rev"][0])
        if version != "1" or not repository or not document_path or not revision:
            self._send_share_error(send_body)
            return True
        preview_title = normalize_share_preview_text(
            preview_title_values[0] if preview_title_values else "",
            SHARE_PREVIEW_TITLE_MAX_LENGTH,
        )
        preview_snippet = normalize_share_preview_text(
            preview_snippet_values[0] if preview_snippet_values else "",
            SHARE_PREVIEW_SNIPPET_MAX_LENGTH,
        )
        if ((preview_title_values and not preview_title)
                or (preview_snippet_values and not preview_snippet)):
            self._send_share_error(send_body)
            return True

        handoff_id = self.server.handoffs.create()
        deep_link = f"{HOSTED_HANDOFF_PROTOCOL}://open-shared?" + urlencode({
            "v": "1",
            "repo": repository,
            "path": document_path,
            "rev": revision,
            "handoff": handoff_id,
        })
        detail = f"{repository} · {document_path}"
        body = open_page_html(
            preview_title or posixpath.basename(document_path),
            detail,
            deep_link,
            handoff_id,
            status_endpoint="/share/status",
            preview_title=preview_title or posixpath.basename(document_path),
            preview_description=preview_snippet or detail,
        ).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self._send_open_headers(len(body))
        self.end_headers()
        if send_body:
            self.wfile.write(body)
        return True

    def _send_share_error(self, send_body):
        body = open_page_html(
            "无法打开分享链接",
            "这个分享链接无效、不完整或来自不支持的版本。",
            "",
            "",
        ).encode("utf-8")
        self.send_response(HTTPStatus.BAD_REQUEST)
        self._send_open_headers(len(body))
        self.end_headers()
        if send_body:
            self.wfile.write(body)

    def _send_open_error(self, send_body):
        body = open_page_html(
            "无法打开 OpenGlance",
            "这个文档链接无效或不完整。",
            "",
            "",
        ).encode("utf-8")
        self.send_response(HTTPStatus.BAD_REQUEST)
        self._send_open_headers(len(body))
        self.end_headers()
        if send_body:
            self.wfile.write(body)

    def _send_open_headers(self, content_length):
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(content_length))
        self.send_header("Cache-Control", "no-store")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
            "connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        )
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")

    def _handle_open_status(self):
        parsed = urlparse(self.path)
        if parsed.path != "/open/status":
            return False
        handoff_id = single_handoff_id(parsed.query)
        if not handoff_id:
            self._send_json(HTTPStatus.BAD_REQUEST, {"opened": False})
            return True
        self._send_json(HTTPStatus.OK, {
            "opened": self.server.handoffs.opened(handoff_id),
        })
        return True

    def _handle_share_status(self):
        parsed = urlparse(self.path)
        if parsed.path != "/share/status":
            return False
        handoff_id = single_handoff_id(parsed.query)
        if not handoff_id:
            self._send_json(HTTPStatus.BAD_REQUEST, {"opened": False, "state": "invalid"})
            return True
        state = self.server.handoffs.state(handoff_id)
        self._send_json(HTTPStatus.OK, {
            "opened": state == "opened",
            "state": state,
        })
        return True

    def _handle_share_state(self):
        parsed = urlparse(self.path)
        if parsed.path != "/share/state":
            return False
        handoff_id = single_handoff_id(parsed.query)
        state_values = parse_qs(parsed.query, keep_blank_values=True).get("state", [])
        if not handoff_id or len(state_values) != 1:
            self._send_json(HTTPStatus.BAD_REQUEST, {"updated": False})
            return True
        if not self.server.handoffs.update(handoff_id, state_values[0]):
            self._send_json(HTTPStatus.NOT_FOUND, {"updated": False})
            return True
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        return True

    def _handle_open_confirm(self):
        parsed = urlparse(self.path)
        if parsed.path != "/open/confirm":
            return False
        handoff_id = single_handoff_id(parsed.query)
        if not handoff_id:
            self._send_json(HTTPStatus.BAD_REQUEST, {"confirmed": False})
            return True
        if not self.server.handoffs.confirm(handoff_id):
            self._send_json(HTTPStatus.NOT_FOUND, {"confirmed": False})
            return True
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        return True

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _handle_telemetry_events(self):
        if urlparse(self.path).path != "/telemetry/v1/events":
            return False
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            self._send_json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"accepted": 0, "error": "invalid_request"})
            return True
        content_length = self.headers.get("Content-Length", "")
        try:
            body_length = int(content_length)
        except ValueError:
            body_length = -1
        if body_length <= 0 or body_length > TELEMETRY_MAX_BODY_BYTES:
            self._send_json(HTTPStatus.BAD_REQUEST, {"accepted": 0, "error": "invalid_request"})
            return True
        try:
            payload = json.loads(self.rfile.read(body_length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(HTTPStatus.BAD_REQUEST, {"accepted": 0, "error": "invalid_json"})
            return True
        events = payload.get("events") if exact_dict_keys(payload, {"events"}) else None
        if (
            not isinstance(events, list)
            or not events
            or len(events) > TELEMETRY_MAX_BATCH_EVENTS
            or not all(valid_telemetry_event(event) for event in events)
        ):
            self._send_json(HTTPStatus.BAD_REQUEST, {"accepted": 0, "error": "invalid_event"})
            return True
        source = self.client_address[0] if self.client_address else "unknown"
        if not self.server.telemetry_rate_limiter.allow(source, events):
            self._send_json(HTTPStatus.TOO_MANY_REQUESTS, {"accepted": 0, "error": "rate_limited"})
            return True

        received_at = datetime.now(timezone.utc)
        stored_events = [
            {**event, "received_at": received_at.isoformat(timespec="milliseconds").replace("+00:00", "Z")}
            for event in events
        ]
        try:
            self.server.telemetry_log_store.append(stored_events, received_at)
        except OSError:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"accepted": 0, "error": "write_failed"})
            return True
        self._send_json(HTTPStatus.ACCEPTED, {"accepted": len(stored_events)})
        return True

    def _handle_mac_release_feed(self, send_body):
        match = re.fullmatch(
            r"/git-leaf/([^/]+)/(darwin-(?:universal|arm64))/releases/([^/]+)",
            urlparse(self.path).path,
        )
        if not match:
            return False

        channel = unquote(match.group(1))
        platform = match.group(2)
        current_version = unquote(match.group(3))
        latest_path = Path(self.directory) / "git-leaf" / channel / platform / "latest.json"
        try:
            manifest = json.loads(latest_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            self.send_error(HTTPStatus.NOT_FOUND, "latest.json not found")
            return True
        except json.JSONDecodeError:
            self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, "latest.json is invalid")
            return True

        if compare_versions(str(manifest.get("version", "")), current_version) <= 0:
            self.send_response(HTTPStatus.NO_CONTENT)
            self.end_headers()
            return True

        payload = manifest.get("autoUpdater") or {}
        body = json.dumps({
            "url": payload.get("url", ""),
            "name": payload.get("name", f"OpenGlance {manifest.get('version', '')}"),
            "notes": payload.get("notes", manifest.get("notes", "")),
            "pub_date": payload.get("pub_date", manifest.get("publishedAt", "")),
        }, ensure_ascii=False).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if send_body:
            self.wfile.write(body)
        return True


def valid_telemetry_event(event):
    if not exact_dict_keys(event, {
        "schema_version", "event_id", "install_id", "event_name", "occurred_at",
        "local_date", "timezone_offset_minutes", "app", "properties",
    }):
        return False
    if event.get("schema_version") != 1:
        return False
    if not short_identifier(event.get("event_id"), 16, 80):
        return False
    if not short_identifier(event.get("install_id"), 16, 80):
        return False
    event_name = event.get("event_name")
    if event_name not in TELEMETRY_EVENT_NAMES:
        return False
    occurred_at = parse_iso_timestamp(event.get("occurred_at"))
    if occurred_at is None:
        return False
    local_date = parse_local_date(event.get("local_date"))
    if local_date is None:
        return False
    timezone_offset = event.get("timezone_offset_minutes")
    if not isinstance(timezone_offset, int) or isinstance(timezone_offset, bool) or not -840 <= timezone_offset <= 840:
        return False
    expected_local_date = (
        occurred_at.astimezone(timezone.utc) + timedelta(minutes=timezone_offset)
    ).date()
    if local_date != expected_local_date:
        return False
    if not valid_telemetry_app(event.get("app")):
        return False
    properties = event.get("properties")
    if event_name == "git_leaf.installation.observed":
        return valid_installation_properties(properties)
    if event_name == "git_leaf.update.state_changed":
        return valid_update_properties(properties, event["app"]["version"])
    return valid_daily_summary_properties(properties, event["install_id"], local_date)


def valid_telemetry_app(app):
    if not exact_dict_keys(app, {
        "version", "build_id", "channel", "platform", "arch", "os_version_major",
    }):
        return False
    return (
        valid_semver(app.get("version"))
        and bounded_text(app.get("build_id"), 1, 120)
        and app.get("channel") == "stable"
        and app.get("platform") in {"darwin", "win32"}
        and app.get("arch") in {"arm64", "x64"}
        and bounded_text(app.get("os_version_major"), 0, 12)
    )


def valid_installation_properties(properties):
    if not isinstance(properties, dict) or not set(properties).issubset({"reason", "device_name"}):
        return False
    if properties.get("reason") not in {"first_observed", "device_name_changed"}:
        return False
    return "device_name" not in properties or bounded_text(properties.get("device_name"), 1, 120)


def valid_update_properties(properties, app_version):
    if not isinstance(properties, dict) or not set(properties).issubset({
        "state", "trigger", "from_version", "to_version", "error_code", "stage",
    }):
        return False
    if properties.get("state") not in {
        "check_started", "current", "available", "downloaded", "skipped",
        "install_started", "completed", "failed",
    }:
        return False
    if properties.get("trigger") not in {"automatic", "manual", "windows_bootstrap"}:
        return False
    if "from_version" in properties and not valid_semver(properties.get("from_version")):
        return False
    if (
        "to_version" in properties
        and properties.get("to_version") is not None
        and not valid_semver(properties.get("to_version"))
    ):
        return False
    if "error_code" in properties and properties.get("error_code") not in {
        "network", "manifest", "signature", "copy", "launch", "downgrade_blocked", "unknown",
    }:
        return False
    if "stage" in properties and (
        properties.get("state") != "failed"
        or properties.get("stage") not in {"check", "download", "prepare", "install", "launch", "unknown"}
    ):
        return False
    if properties.get("state") != "failed" and "error_code" in properties:
        return False
    if "from_version" not in properties:
        return False
    if compare_semvers(app_version, TELEMETRY_STRICT_UPDATE_CONTRACT_VERSION) < 0:
        # Queued events retain the event-time App version. Older releases did not
        # require failure stage/error fields or target versions, so keep accepting
        # that historical wire contract while validating every field that is present.
        return True

    keys = set(properties)
    state = properties["state"]
    from_version = properties.get("from_version")
    to_version = properties.get("to_version")
    if state == "check_started":
        return (
            keys == {"state", "trigger", "from_version"}
            and compare_semvers(from_version, app_version) == 0
        )
    if state == "failed":
        if not {"state", "trigger", "from_version", "error_code", "stage"}.issubset(keys):
            return False
        if not keys.issubset({"state", "trigger", "from_version", "to_version", "error_code", "stage"}):
            return False
        if properties["stage"] != "check" and to_version is None:
            return False
        return compare_semvers(from_version, app_version) == 0

    if keys != {"state", "trigger", "from_version", "to_version"} or to_version is None:
        return False
    if state == "completed":
        return (
            compare_semvers(to_version, app_version) == 0
            and compare_semvers(to_version, from_version) != 0
        )
    if compare_semvers(from_version, app_version) != 0:
        return False
    comparison = compare_semvers(to_version, from_version)
    if state == "current":
        return comparison <= 0
    return comparison > 0


def valid_daily_summary_properties(properties, install_id, event_local_date):
    base_keys = {
        "summary_id", "revision", "launch_count", "launch_counts_by_entry_kind",
        "active_minutes", "repository_open_count", "repository_switch_count",
        "distinct_repository_count", "rolling_30d_distinct_repository_count",
        "worktree_switch_count", "mode_minutes", "feature_counts",
    }
    has_summary_date = isinstance(properties, dict) and "summary_date" in properties
    duration_keys = {
        "activity_duration_contract", "foreground_exposure_ms", "interactive_active_ms",
        "mode_foreground_exposure_ms", "mode_interactive_ms",
    }
    has_duration = isinstance(properties, dict) and any(key in properties for key in duration_keys)
    expected_keys = (
        base_keys
        | ({"summary_date"} if has_summary_date else set())
        | (duration_keys if has_duration else set())
    )
    if not exact_dict_keys(properties, expected_keys):
        return False
    summary_id = properties.get("summary_id")
    if not isinstance(summary_id, str) or not re.fullmatch(r"[a-f0-9]{32,64}", summary_id):
        return False
    if has_summary_date:
        summary_date = properties.get("summary_date")
        parsed_summary_date = parse_local_date(summary_date)
        if parsed_summary_date is None or parsed_summary_date > event_local_date:
            return False
        expected_summary_id = hashlib.sha256(
            f"{install_id}:{summary_date}".encode("utf-8")
        ).hexdigest()[:len(summary_id)]
        if summary_id != expected_summary_id:
            return False
    if not bounded_integer(properties.get("revision"), 1, 100000):
        return False
    for key in {
        "launch_count", "active_minutes", "repository_open_count", "repository_switch_count",
        "distinct_repository_count", "rolling_30d_distinct_repository_count", "worktree_switch_count",
    }:
        if not bounded_integer(properties.get(key), 0, 1000000):
            return False
    launch_counts = properties.get("launch_counts_by_entry_kind")
    if not isinstance(launch_counts, dict) or not set(launch_counts).issubset({
        "manual", "deep_link", "update_restart", "windows_bootstrap", "unknown",
    }):
        return False
    if not all(bounded_integer(count, 0, 1000000) for count in launch_counts.values()):
        return False
    mode_minutes = properties.get("mode_minutes")
    if not exact_dict_keys(mode_minutes, {"preview", "source", "live"}):
        return False
    if not all(bounded_integer(count, 0, 1000000) for count in mode_minutes.values()):
        return False
    if has_duration and not valid_activity_duration_properties(properties):
        return False
    feature_counts = properties.get("feature_counts")
    return (
        isinstance(feature_counts, list)
        and len(feature_counts) <= 100
        and all(valid_feature_counter(counter) for counter in feature_counts)
    )


def valid_activity_duration_properties(properties):
    if properties.get("activity_duration_contract") != "foreground_interactive_v1":
        return False
    foreground_exposure_ms = properties.get("foreground_exposure_ms")
    interactive_ms = properties.get("interactive_active_ms")
    mode_foreground_exposure_ms = properties.get("mode_foreground_exposure_ms")
    mode_interactive_ms = properties.get("mode_interactive_ms")
    if not bounded_integer(foreground_exposure_ms, 0, 172800000):
        return False
    if not bounded_integer(interactive_ms, 0, 172800000):
        return False
    if not exact_dict_keys(mode_foreground_exposure_ms, {"preview", "source", "live"}):
        return False
    if not exact_dict_keys(mode_interactive_ms, {"preview", "source", "live"}):
        return False
    if not all(bounded_integer(value, 0, 172800000) for value in mode_foreground_exposure_ms.values()):
        return False
    if not all(bounded_integer(value, 0, 172800000) for value in mode_interactive_ms.values()):
        return False
    return True


def valid_feature_counter(counter):
    if not isinstance(counter, dict) or not set(counter).issubset({"feature_id", "dimensions", "count"}):
        return False
    if set(counter) not in ({"feature_id", "count"}, {"feature_id", "dimensions", "count"}):
        return False
    feature_id = counter.get("feature_id")
    allowed_dimensions = TELEMETRY_FEATURE_DIMENSIONS.get(feature_id)
    if allowed_dimensions is None or not bounded_integer(counter.get("count"), 1, 1000000):
        return False
    dimensions = counter.get("dimensions", {})
    if not isinstance(dimensions, dict) or not set(dimensions).issubset(allowed_dimensions):
        return False
    if not all(value in allowed_dimensions[key] for key, value in dimensions.items()):
        return False
    if (
        feature_id == "navigation.deep_link"
        and "failure_reason" in dimensions
        and dimensions.get("result") != "error"
    ):
        return False
    return True


def exact_dict_keys(value, expected):
    return isinstance(value, dict) and set(value) == set(expected)


def bounded_text(value, minimum, maximum):
    return (
        isinstance(value, str)
        and minimum <= len(value) <= maximum
        and re.search(r"[\x00-\x1f\x7f]", value) is None
    )


def bounded_integer(value, minimum, maximum):
    return isinstance(value, int) and not isinstance(value, bool) and minimum <= value <= maximum


def short_identifier(value, minimum, maximum):
    return isinstance(value, str) and minimum <= len(value) <= maximum and bool(re.fullmatch(r"[A-Za-z0-9_-]+", value))


def valid_semver(value):
    return parse_semver(value) is not None


def parse_semver(value):
    if not isinstance(value, str) or len(value) > 40:
        return None
    match = SEMVER_PATTERN.fullmatch(value)
    if not match:
        return None
    prerelease = tuple((match.group(4) or "").split(".")) if match.group(4) else ()
    if any(identifier.isdigit() and len(identifier) > 1 and identifier.startswith("0") for identifier in prerelease):
        return None
    return (int(match.group(1)), int(match.group(2)), int(match.group(3)), prerelease)


def compare_semvers(left, right):
    left_value = parse_semver(left)
    right_value = parse_semver(right)
    if left_value is None or right_value is None:
        raise ValueError("compare_semvers requires valid semantic versions")
    if left_value[:3] != right_value[:3]:
        return 1 if left_value[:3] > right_value[:3] else -1
    left_prerelease = left_value[3]
    right_prerelease = right_value[3]
    if not left_prerelease or not right_prerelease:
        if left_prerelease == right_prerelease:
            return 0
        return -1 if left_prerelease else 1
    for left_identifier, right_identifier in zip(left_prerelease, right_prerelease):
        if left_identifier == right_identifier:
            continue
        left_numeric = left_identifier.isdigit()
        right_numeric = right_identifier.isdigit()
        if left_numeric and right_numeric:
            return 1 if int(left_identifier) > int(right_identifier) else -1
        if left_numeric != right_numeric:
            return -1 if left_numeric else 1
        return 1 if left_identifier > right_identifier else -1
    if len(left_prerelease) == len(right_prerelease):
        return 0
    return 1 if len(left_prerelease) > len(right_prerelease) else -1


def parse_iso_timestamp(value):
    if not isinstance(value, str) or len(value) > 40 or not ISO_TIMESTAMP_PATTERN.fullmatch(value):
        return None
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00" if value.endswith("Z") else value)
        return parsed if parsed.tzinfo is not None and parsed.utcoffset() is not None else None
    except ValueError:
        return None


def parse_local_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return None
    try:
        parsed = date.fromisoformat(value)
        return parsed if parsed.isoformat() == value else None
    except ValueError:
        return None


def normalize_repository_identity(value):
    clean_value = str(value or "").strip().removesuffix(".git").lower()
    if re.fullmatch(r"[a-z0-9_.-]+/[a-z0-9_.-]+", clean_value):
        return clean_value
    return ""


def normalize_document_path(value):
    clean_value = str(value or "").strip()
    if not clean_value or "\\" in clean_value or "\x00" in clean_value:
        return ""
    if clean_value.startswith("/"):
        return ""
    normalized = posixpath.normpath(clean_value)
    if normalized == ".." or normalized.startswith("../"):
        return ""
    if not re.search(r"\.mdx?$", normalized, re.IGNORECASE):
        return ""
    return normalized


def normalize_worktree_id(value):
    clean_value = str(value or "").strip().lower()
    return clean_value if re.fullmatch(r"[a-f0-9]{16}", clean_value) else ""


def normalize_git_revision(value):
    clean_value = str(value or "").strip().lower()
    return clean_value if re.fullmatch(r"[a-f0-9]{40}(?:[a-f0-9]{24})?", clean_value) else ""


def single_handoff_id(query):
    values = parse_qs(query, keep_blank_values=True).get("id", [])
    if len(values) != 1 or not HANDOFF_ID_PATTERN.fullmatch(values[0]):
        return ""
    return values[0]


def download_page_language(query, accept_language):
    requested = query.get("lang", [])
    if len(requested) == 1:
        normalized = requested[0].strip().lower()
        if normalized in {"zh", "zh-cn", "zh-hans"}:
            return "zh-CN"
        if normalized == "en" or normalized.startswith("en-"):
            return "en"
    for language_range in str(accept_language or "").split(","):
        normalized = language_range.split(";", 1)[0].strip().lower()
        if normalized == "zh" or normalized.startswith("zh-"):
            return "zh-CN"
        if normalized == "en" or normalized.startswith("en-"):
            return "en"
    return "en"


def latest_public_downloads(root, channel="stable"):
    targets = (
        ("macos", ("darwin-universal", "darwin-arm64"), "dmg"),
        ("windows", ("win32-x64",), "zip"),
    )
    downloads = {}
    for product_key, platforms, artifact_kind in targets:
        for platform in platforms:
            manifest_path = Path(root) / "git-leaf" / channel / platform / "latest.json"
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (FileNotFoundError, json.JSONDecodeError, OSError):
                continue
            artifact = public_download_artifact(
                manifest,
                root=root,
                channel=channel,
                platform=platform,
                artifact_kind=artifact_kind,
            )
            if not artifact:
                continue
            downloads[product_key] = artifact
            break
    return downloads


def public_download_artifact(manifest, root, channel, platform, artifact_kind):
    if not is_public_download_manifest(manifest):
        return None
    if manifest.get("channel") != channel or manifest.get("platform") != platform:
        return None
    version = manifest.get("version")
    if not valid_semver(version):
        return None
    artifact = (manifest.get("files") or {}).get(artifact_kind)
    if not isinstance(artifact, dict):
        return None
    url = str(artifact.get("url", "")).strip()
    sha256 = str(artifact.get("sha256", "")).strip().lower()
    size = artifact.get("size")
    parsed_url = urlparse(url)
    expected_prefix = f"/git-leaf/{channel}/{platform}/"
    if (
        parsed_url.scheme != "https"
        or parsed_url.netloc != "updates.mangofuture.com"
        or parsed_url.params
        or parsed_url.query
        or parsed_url.fragment
        or not unquote(parsed_url.path).startswith(expected_prefix)
        or "/" in unquote(parsed_url.path)[len(expected_prefix):]
        or not unquote(parsed_url.path).lower().endswith(f".{artifact_kind}")
        or not re.fullmatch(r"[a-f0-9]{64}", sha256)
        or isinstance(size, bool)
        or not isinstance(size, int)
        or size < 0
    ):
        return None
    artifact_path = (Path(root) / unquote(parsed_url.path).lstrip("/")).resolve()
    root_path = Path(root).resolve()
    try:
        if (
            not artifact_path.is_relative_to(root_path)
            or not artifact_path.is_file()
            or artifact_path.stat().st_size != size
        ):
            return None
    except OSError:
        return None
    return {
        "platform": platform,
        "version": version,
        "url": download_page_url(url),
        "sha256": sha256,
        "size": size,
    }


def download_page_url(url):
    parsed = urlparse(url)
    query = parse_qs(parsed.query, keep_blank_values=True)
    query["source"] = ["download-page"]
    return parsed._replace(query=urlencode(query, doseq=True)).geturl()


def distribution_download_record(root, request_target):
    parsed = urlparse(request_target)
    if parse_qs(parsed.query, keep_blank_values=True) != {"source": ["download-page"]}:
        return None
    match = re.fullmatch(
        r"/git-leaf/(stable)/(darwin-(?:universal|arm64)|win32-x64)/([^/]+\.(dmg|zip))",
        parsed.path,
    )
    if not match:
        return None
    channel, platform, filename, artifact = match.groups()
    if (platform.startswith("darwin-") and artifact != "dmg") or (
        platform == "win32-x64" and artifact != "zip"
    ):
        return None

    manifest_path = Path(root) / "git-leaf" / channel / platform / "latest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not is_public_download_manifest(manifest):
            return None
        artifact_info = (manifest.get("files") or {}).get(artifact) or {}
        manifest_url = urlparse(str(artifact_info.get("url", "")))
        target = (Path(root) / unquote(parsed.path).lstrip("/")).resolve()
        root_path = Path(root).resolve()
        if (
            unquote(manifest_url.path) != unquote(parsed.path)
            or not target.is_relative_to(root_path)
            or not target.is_file()
        ):
            return None
        size = target.stat().st_size
    except (FileNotFoundError, json.JSONDecodeError, OSError, ValueError):
        return None

    version = manifest.get("version")
    if not valid_semver(version):
        return None
    return {
        "channel": channel,
        "platform": platform,
        "version": version,
        "artifact": artifact,
        "source": "download_page",
        "bytes": size,
    }


def is_public_download_manifest(manifest):
    return isinstance(manifest, dict) and manifest.get("releaseTrack") == "public"


def format_download_size(size):
    value = float(size)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            precision = 0 if unit == "B" else 1
            return f"{value:.{precision}f} {unit}"
        value /= 1024
    return f"{size} B"


def download_page_html(language, downloads):
    is_chinese = language == "zh-CN"
    copy = {
        "title": "OpenGlance 下载" if is_chinese else "Download OpenGlance",
        "category": "面向团队与 AI Agent 共享上下文仓库的桌面应用。" if is_chinese
        else "A desktop interface for Git repositories used as shared context by teams and AI agents.",
        "value": "一个供 Agent 直接工作的仓库，一个供人使用的熟悉界面。" if is_chinese
        else "One repository for agents. A familiar interface for people.",
        "collaboration": (
            "AI Agent 直接使用 Git 仓库；人通过 OpenGlance 阅读、检查并做范围明确的小修改。"
            if is_chinese else
            "AI agents work directly in Git. People use OpenGlance to read, inspect, and make focused edits."
        ),
        "latest": "最新公开版本" if is_chinese else "Latest public release",
        "unavailable_title": "公开安装包暂不可用" if is_chinese else "Public builds are not available yet",
        "unavailable_detail": (
            "当前没有通过公开发布验证的安装包。你仍然可以查看源码并从源码运行；内部发行版不会出现在这里。"
            if is_chinese else
            "No installer has passed the public release gate yet. You can still inspect and run the source; "
            "internal distributions are never shown here."
        ),
        "mac_status": "Developer ID 签名并通过 Apple 公证" if is_chinese
        else "Developer ID signed and Apple notarized",
        "mac_button": "下载 macOS 版" if is_chinese else "Download for macOS",
        "mac_unavailable": "macOS 版暂不可用" if is_chinese else "macOS build unavailable",
        "windows_status": "未签名 Preview" if is_chinese else "Unsigned Preview",
        "windows_detail": (
            "Windows 会显示未知发布者警告。运行前请核对下方 SHA-256。"
            if is_chinese else
            "Windows will show an unknown-publisher warning. Verify the SHA-256 below before running."
        ),
        "windows_button": "下载 Windows Preview" if is_chinese else "Download Windows Preview",
        "windows_unavailable": "Windows Preview 暂不可用" if is_chinese else "Windows Preview unavailable",
        "sha": "SHA-256",
        "source": "查看源码与运行说明" if is_chinese else "View source and run instructions",
        "privacy": (
            "下载页只展示明确标记为 public 的 stable 版本。"
            if is_chinese else
            "This page only shows stable releases explicitly marked public."
        ),
    }
    mac = downloads.get("macos")
    windows = downloads.get("windows")
    public_versions = sorted({
        download["version"] for download in (mac, windows) if download
    })
    release_label = (
        f'<p class="release-label">{html.escape(copy["latest"])}: '
        f'{html.escape(" / ".join(public_versions))}</p>'
        if public_versions else ""
    )

    def platform_card(identifier, title, status, action, unavailable, download, detail=""):
        safe_detail = f'<p class="warning">{html.escape(detail)}</p>' if detail else ""
        if download:
            button = (
                f'<a class="button" href="{html.escape(download["url"], quote=True)}" '
                f'rel="noopener noreferrer">{html.escape(action)} {html.escape(download["version"])}</a>'
            )
            metadata = (
                f'<dl><div><dt>{copy["sha"]}</dt><dd><code>{download["sha256"]}</code></dd></div>'
                f'<div><dt>{"大小" if is_chinese else "Size"}</dt>'
                f'<dd>{html.escape(format_download_size(download["size"]))}</dd></div></dl>'
            )
        else:
            button = f'<span class="button disabled" aria-disabled="true">{html.escape(unavailable)}</span>'
            metadata = ""
        return (
            f'<article id="{identifier}" class="platform-card">'
            f'<div><p class="platform-status">{html.escape(status)}</p><h2>{html.escape(title)}</h2>'
            f'{safe_detail}</div>{button}{metadata}</article>'
        )

    empty_state = ""
    if not downloads:
        empty_state = (
            f'<aside class="notice"><strong>{html.escape(copy["unavailable_title"])}</strong>'
            f'<p>{html.escape(copy["unavailable_detail"])}</p></aside>'
        )
    alternate_language = (
        '<a href="/download?lang=en" lang="en">English</a>'
        if is_chinese else
        '<a href="/download?lang=zh-CN" lang="zh-CN">简体中文</a>'
    )
    return f"""<!doctype html>
<html lang="{language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="{html.escape(copy["category"], quote=True)}">
  <title>{html.escape(copy["title"])}</title>
  <style>
    :root {{ color-scheme: light dark; font-family: Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; background: #f5f7f3; color: #172019; }}
    a {{ color: inherit; }}
    .shell {{ width: min(1040px,calc(100% - 40px)); margin: 0 auto; }}
    header {{ display: flex; align-items: center; justify-content: space-between; padding: 28px 0; }}
    .brand {{ font-weight: 760; letter-spacing: -.02em; text-decoration: none; }}
    .language {{ color: #526158; font-size: 14px; text-underline-offset: 3px; }}
    .hero {{ padding: 62px 0 46px; max-width: 830px; }}
    .eyebrow {{ color: #237a50; font-size: 13px; font-weight: 760; letter-spacing: .08em; text-transform: uppercase; }}
    h1 {{ margin: 14px 0 18px; font-size: clamp(40px,7vw,72px); line-height: .98; letter-spacing: -.055em; }}
    .lead {{ margin: 0 0 12px; max-width: 720px; font-size: clamp(19px,2.5vw,27px); line-height: 1.4; }}
    .collaboration {{ margin: 0; max-width: 760px; color: #58665e; font-size: 17px; line-height: 1.6; }}
    .release-label {{ margin: 0 0 18px; font-size: 14px; color: #526158; }}
    .notice {{ margin-bottom: 18px; padding: 18px 20px; border: 1px solid #d9e2dc; border-radius: 14px; background: #fff; }}
    .notice p {{ margin: 6px 0 0; color: #5a675f; line-height: 1.55; }}
    .platforms {{ display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 18px; }}
    .platform-card {{ min-height: 310px; display: flex; flex-direction: column; align-items: flex-start; padding: 28px; border: 1px solid #d9e2dc; border-radius: 20px; background: #fff; box-shadow: 0 20px 55px rgba(36,70,49,.08); }}
    .platform-card h2 {{ margin: 8px 0 0; font-size: 30px; letter-spacing: -.035em; }}
    .platform-status {{ margin: 0; color: #237a50; font-size: 13px; font-weight: 720; }}
    .warning {{ margin: 10px 0 0; color: #6c5945; line-height: 1.5; }}
    .button {{ margin-top: auto; display: inline-block; padding: 12px 18px; border-radius: 10px; background: #237a50; color: #fff; font-weight: 720; text-decoration: none; }}
    .button.disabled {{ background: #dfe5e1; color: #68736c; cursor: not-allowed; }}
    dl {{ width: 100%; margin: 22px 0 0; color: #5a675f; font-size: 13px; }}
    dl div {{ display: grid; grid-template-columns: 66px minmax(0,1fr); gap: 12px; margin-top: 9px; }}
    dt {{ font-weight: 720; }} dd {{ margin: 0; overflow-wrap: anywhere; }} code {{ font-size: 11px; }}
    .source {{ display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 28px 0 52px; color: #526158; }}
    .source a {{ color: #176b43; font-weight: 720; text-underline-offset: 4px; }}
    .source p {{ margin: 0; font-size: 13px; }}
    @media (max-width: 700px) {{ .hero {{ padding-top: 36px; }} .platforms {{ grid-template-columns: 1fr; }} .source {{ align-items: flex-start; flex-direction: column; }} }}
    @media (prefers-color-scheme: dark) {{
      body {{ background: #101511; color: #eef4ef; }}
      .language,.collaboration,.release-label,.source,dl {{ color: #aeb9b1; }}
      .notice,.platform-card {{ background: #171e19; border-color: #2e3a32; box-shadow: none; }}
      .notice p {{ color: #aeb9b1; }} .button.disabled {{ background: #313a34; color: #aeb9b1; }}
      .warning {{ color: #d2b994; }} .source a {{ color: #70d3a4; }}
    }}
  </style>
</head>
<body>
  <div class="shell">
    <header><a class="brand" href="/download">OpenGlance</a><span class="language">{alternate_language}</span></header>
    <main>
      <section class="hero">
        <p class="eyebrow">{html.escape(copy["category"])}</p>
        <h1>{html.escape(copy["title"])}</h1>
        <p class="lead">{html.escape(copy["value"])}</p>
        <p class="collaboration">{html.escape(copy["collaboration"])}</p>
      </section>
      {release_label}
      {empty_state}
      <section class="platforms" aria-label="{html.escape(copy["latest"], quote=True)}">
        {platform_card("macos", "macOS", copy["mac_status"], copy["mac_button"], copy["mac_unavailable"], mac)}
        {platform_card("windows", "Windows", copy["windows_status"], copy["windows_button"], copy["windows_unavailable"], windows, copy["windows_detail"])}
      </section>
      <footer class="source">
        <a href="https://github.com/openglance/openglance#run-from-source" rel="noopener noreferrer">{html.escape(copy["source"])}</a>
        <p>{html.escape(copy["privacy"])}</p>
      </footer>
    </main>
  </div>
</body>
</html>"""


def normalize_share_preview_text(value, max_length):
    text = " ".join(str(value or "").split())
    if not text or len(text) > max_length:
        return ""
    if any(ord(character) < 32 for character in text):
        return ""
    return text


def open_page_html(
        title,
        detail,
        deep_link,
        handoff_id,
        status_endpoint="/open/status",
        preview_title="",
        preview_description="",
):
    safe_title = html.escape(title)
    safe_detail = html.escape(detail)
    safe_deep_link = html.escape(deep_link, quote=True)
    safe_document_title = html.escape(preview_title or title)
    preview_meta = ""
    if preview_title or preview_description:
        safe_preview_title = html.escape(preview_title or title, quote=True)
        safe_preview_description = html.escape(preview_description or detail, quote=True)
        preview_meta = (
            f'  <meta name="description" content="{safe_preview_description}">\n'
            f'  <meta property="og:title" content="{safe_preview_title}">\n'
            f'  <meta property="og:description" content="{safe_preview_description}">\n'
            '  <meta property="og:site_name" content="OpenGlance">\n'
            '  <meta property="og:type" content="article">\n'
        )
    launch_script = ""
    button = ""
    if deep_link:
        status_path = status_endpoint + "?" + urlencode({"id": handoff_id})
        launch_script = (
            "<script>(()=>{"
            "const status=document.querySelector('#handoff-status');"
            "const attemptClose=()=>{"
            "if(status)status.textContent='OpenGlance 已确认打开，正在关闭此页面…';"
            "window.close();window.setTimeout(()=>{"
            "if(status)status.textContent='OpenGlance 已打开。浏览器未允许自动关闭时，可以关闭此页面。';"
            "},250);};"
            "let handoffCompleted=false;let pollTimer=0;"
            "const pollHandoff=async()=>{"
            "if(handoffCompleted)return;"
            "try{"
            f"const response=await window.fetch({json.dumps(status_path)},{{cache:'no-store'}});"
            "if(!response.ok)return;"
            "const result=await response.json();"
            "if(!result.opened){"
            "if(result.state==='cancelled')status.textContent='已在 OpenGlance 中取消打开。可以点击按钮重试。';"
            "else if(result.state==='failed')status.textContent='OpenGlance 无法完成打开。请在应用中处理后重试。';"
            "else if(result.state==='received')status.textContent='OpenGlance 已收到链接，正在检查本地知识库…';"
            "return;}"
            "handoffCompleted=true;window.clearInterval(pollTimer);attemptClose();"
            "}catch{}"
            "};"
            "window.addEventListener('DOMContentLoaded',()=>{"
            "document.querySelector('#launch-link')?.addEventListener('click',pollHandoff);"
            "pollTimer=window.setInterval(pollHandoff,300);void pollHandoff();"
            f"window.location.href={json.dumps(deep_link, ensure_ascii=False)};"
            "},{once:true});"
            "})();</script>"
        )
        button = f'<a id="launch-link" class="button" href="{safe_deep_link}">在 OpenGlance 中打开</a>'
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{safe_document_title}</title>
  <link rel="icon" type="image/png" sizes="64x64" href="/open/icon.png">
  <link rel="apple-touch-icon" href="/open/icon.png">
{preview_meta}  <style>
    :root {{ color-scheme: light dark; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }}
    body {{ margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f7f5; color: #18211d; }}
    main {{ width: min(420px,calc(100vw - 48px)); padding: 36px; border: 1px solid #dce5df; border-radius: 18px; background: #fff; box-shadow: 0 18px 48px rgba(27,62,45,.12); text-align: center; }}
    h1 {{ margin: 0 0 12px; font-size: 25px; overflow-wrap: anywhere; }} p {{ margin: 0 0 26px; color: #5c6861; line-height: 1.6; overflow-wrap: anywhere; }}
    .button {{ display: inline-block; padding: 11px 18px; border-radius: 9px; background: #238a5a; color: #fff; font-weight: 650; text-decoration: none; }}
    .status {{ margin: 18px 0 0; font-size: 13px; }}
    @media (prefers-color-scheme: dark) {{ body {{ background:#101512;color:#edf4f0; }} main {{ background:#17201b;border-color:#2a3830; }} p {{ color:#a9b8b0; }} }}
  </style>
</head>
<body><main><h1>{safe_title}</h1><p>{safe_detail}</p>{button}<p id="handoff-status" class="status">如果应用没有自动打开，请点击按钮。</p></main>{launch_script}</body>
</html>"""


def compare_versions(left, right):
    left_parts = version_core(left)
    right_parts = version_core(right)
    length = max(len(left_parts), len(right_parts))
    for index in range(length):
        left_value = left_parts[index] if index < len(left_parts) else 0
        right_value = right_parts[index] if index < len(right_parts) else 0
        if left_value > right_value:
            return 1
        if left_value < right_value:
            return -1
    return 0


def version_core(value):
    core = str(value or "0").strip().lstrip("vV").split("+", 1)[0].split("-", 1)[0]
    parts = []
    for part in core.split("."):
        try:
            parts.append(int(part))
        except ValueError:
            parts.append(0)
    return parts or [0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--telemetry-root")
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8320)
    args = parser.parse_args()

    handler = lambda *handler_args: OpenGlanceUpdateHandler(
        *handler_args,
        directory=args.root,
    )
    server = ThreadingHTTPServer((args.bind, args.port), handler)
    server.handoffs = HandoffRegistry()
    telemetry_root = args.telemetry_root or os.path.join(args.root, ".telemetry")
    server.telemetry_log_store = TelemetryLogStore(telemetry_root)
    server.download_log_store = DistributionDownloadLogStore(telemetry_root)
    server.telemetry_rate_limiter = TelemetryRateLimiter()
    maintenance = TelemetryMaintenanceRunner((
        server.telemetry_log_store,
        server.download_log_store,
    ))
    maintenance.start()
    print(f"PORT={server.server_port}", flush=True)
    try:
        server.serve_forever()
    finally:
        maintenance.stop()
        server.server_close()


if __name__ == "__main__":
    main()
