#!/usr/bin/env python3
"""agent-board 后端：零依赖，Python 标准库 only。
Usage:  python3 server.py            (http://127.0.0.1:8787)
        PORT=9000 python3 server.py
数据: data.json（不存在则从 seed.json 复制）；写盘原子替换。
"""
import json
import os
import time
import uuid
import http.server
import socketserver
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data.json")
SEED = os.path.join(ROOT, "seed.json")
DIST = os.path.join(ROOT, "frontend", "dist")  # React 构建产物；不存在则回退根目录 index.html
MAX_BODY = 1024 * 1024  # 1MB

STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".map": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
}


def content_type(fn):
    _, ext = os.path.splitext(fn)
    return STATIC_TYPES.get(ext, "application/octet-stream")


def serve_file(self, fp, ctype):
    with open(fp, "rb") as f:
        data = f.read()
    self._send(200, data, ctype)

CARD_FIELDS = {"board_id", "type", "title", "body", "url", "path",
               "x", "y", "w", "color", "tags", "status"}
BOARD_FIELDS = {"title", "desc", "color"}


def now():
    return int(time.time())


def nid(prefix):
    return "%s-%s" % (prefix, uuid.uuid4().hex[:8])


def blank():
    return {"meta": {"v": 1}, "boards": [], "cards": []}


def load():
    for fp in (DATA, SEED):
        if os.path.exists(fp):
            try:
                with open(fp, encoding="utf-8") as f:
                    db = json.load(f)
                if isinstance(db, dict) and "boards" in db and "cards" in db:
                    return db
            except Exception:
                pass
    return blank()


def save(db):
    tmp = DATA + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=1)
    os.replace(tmp, DATA)


def blank_board(title, desc="", color="blue"):
    t = now()
    return {"id": nid("b"), "title": title, "desc": desc, "color": color,
            "created_at": t, "updated_at": t}


def blank_card(board_id, **kw):
    t = now()
    card = {"id": nid("c"), "board_id": board_id, "type": "note",
            "title": "", "body": "", "url": "", "path": "",
            "x": 60, "y": 60, "w": 240, "color": "yellow",
            "tags": [], "status": "open",
            "created_at": t, "updated_at": t}
    for k in CARD_FIELDS:
        if k in kw:
            card[k] = kw[k]
    return card


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False)
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _err(self, code, msg):
        self._send(code, {"error": msg})

    def _read_json(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            raise ValueError("bad Content-Length")
        if n < 0 or n > MAX_BODY:
            raise ValueError("body too large")
        raw = self.rfile.read(n) if n else b"{}"
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            raise ValueError("invalid json")

    def do_OPTIONS(self):
        self._send(204, b"")

    # ---------- read ----------
    def do_GET(self):
        p = urlparse(self.path).path
        if p in ("/api/state", "/api/records", "/records"):
            self._send(200, load())
            return
        if p in ("/", ""):
            index = os.path.join(DIST, "index.html") if os.path.isdir(DIST) \
                else os.path.join(ROOT, "index.html")
            serve_file(self, index, "text/html; charset=utf-8")
            return
        # 优先 dist（/assets/* 及 React 产物），再回退项目根目录
        rel = p.lstrip("/")
        for base in (DIST, ROOT):
            fp = os.path.abspath(os.path.join(base, rel))
            if os.path.isfile(fp) and os.path.commonpath([base, fp]) == base:
                serve_file(self, fp, content_type(rel))
                return
        self._err(404, "not found")

    def do_HEAD(self):
        # 复用 GET 路由，只发头
        self.command = "HEAD"
        try:
            self.do_GET()
        finally:
            self.command = "HEAD"

    # ---------- boards ----------
    def do_POST(self):
        p = urlparse(self.path).path
        try:
            payload = self._read_json()
        except ValueError as e:
            self._err(400, str(e))
            return
        if not isinstance(payload, dict):
            self._err(400, "json must be object")
            return
        db = load()
        if p == "/api/boards":
            title = str(payload.get("title", "")).strip()
            if not title:
                self._err(400, "title required")
                return
            b = blank_board(title, str(payload.get("desc", "")),
                            str(payload.get("color", "blue")))
            db["boards"].append(b)
            save(db)
            self._send(200, b)
            return
        if p == "/api/cards":
            board_id = payload.get("board_id", "")
            if not any(b["id"] == board_id for b in db["boards"]):
                self._err(400, "board_id not found")
                return
            kw = {k: payload[k] for k in CARD_FIELDS if k in payload and k != "board_id"}
            c = blank_card(board_id, **kw)
            if not str(c.get("title", "")).strip() and not str(c.get("body", "")).strip():
                self._err(400, "title or body required")
                return
            db["cards"].append(c)
            save(db)
            self._send(200, c)
            return
        self._err(404, "not found")

    def _split_id(self, prefix):
        # /api/boards/<id> 或 /api/cards/<id>
        parts = urlparse(self.path).path.rstrip("/").split("/")
        if len(parts) == 4 and parts[1] == "api" and parts[2] == prefix:
            return parts[3]
        return None

    def do_PATCH(self):
        try:
            payload = self._read_json()
        except ValueError as e:
            self._err(400, str(e))
            return
        if not isinstance(payload, dict):
            self._err(400, "json must be object")
            return
        db = load()
        bid = self._split_id("boards")
        if bid is not None:
            for b in db["boards"]:
                if b["id"] == bid:
                    for k in BOARD_FIELDS:
                        if k in payload:
                            b[k] = payload[k]
                    b["updated_at"] = now()
                    save(db)
                    self._send(200, b)
                    return
            self._err(404, "board not found")
            return
        cid = self._split_id("cards")
        if cid is not None:
            for c in db["cards"]:
                if c["id"] == cid:
                    for k in CARD_FIELDS:
                        if k in payload:
                            c[k] = payload[k]
                    c["updated_at"] = now()
                    save(db)
                    self._send(200, c)
                    return
            self._err(404, "card not found")
            return
        self._err(404, "not found")

    def do_DELETE(self):
        db = load()
        bid = self._split_id("boards")
        if bid is not None:
            db["boards"] = [b for b in db["boards"] if b["id"] != bid]
            db["cards"] = [c for c in db["cards"] if c.get("board_id") != bid]
            save(db)
            self._send(200, {"ok": True})
            return
        cid = self._split_id("cards")
        if cid is not None:
            db["cards"] = [c for c in db["cards"] if c["id"] != cid]
            save(db)
            self._send(200, {"ok": True})
            return
        self._err(404, "not found")

    def log_message(self, fmt, *args):
        line = "%s - %s [%s] %s" % (self.client_address[0], self.command,
                                    self.log_date_time_string(), fmt % args)
        print(line, flush=True)


if __name__ == "__main__":
    PORT = int(os.environ.get("PORT", 8787))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        print("agent-board: http://127.0.0.1:%d" % PORT, flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
