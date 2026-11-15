#!/usr/bin/env python3
import cgi
from datetime import date
import hashlib
import json
import mimetypes
import os
import re
import secrets
import sqlite3
from http import cookies
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
UPLOAD_DIR = ROOT / "uploads"
DB_PATH = DATA_DIR / "uddh.sqlite3"
PORT = 8000
SESSIONS = {}


def password_hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000).hex()


def database():
    DATA_DIR.mkdir(exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("""
        CREATE TABLE IF NOT EXISTS media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_key TEXT NOT NULL UNIQUE,
            file_url TEXT NOT NULL,
            original_name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    connection.execute("""
        CREATE TABLE IF NOT EXISTS articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            slug TEXT NOT NULL UNIQUE,
            category TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft',
            content TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    article_columns = {row["name"] for row in connection.execute("PRAGMA table_info(articles)").fetchall()}
    if "featured_image" not in article_columns:
        connection.execute("ALTER TABLE articles ADD COLUMN featured_image TEXT NOT NULL DEFAULT ''")
    if "publication_date" not in article_columns:
        connection.execute("ALTER TABLE articles ADD COLUMN publication_date TEXT NOT NULL DEFAULT ''")
    connection.execute("UPDATE articles SET publication_date = substr(created_at, 1, 10) WHERE publication_date = ''")
    connection.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            password_salt TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'editor',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    connection.execute("""
        CREATE TABLE IF NOT EXISTS site_visits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            page_path TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    current_admin = connection.execute("SELECT id FROM users WHERE username = ?", ("admin",)).fetchone()
    new_admin = connection.execute("SELECT id FROM users WHERE username = ?", ("cndh",)).fetchone()
    if current_admin and not new_admin:
        salt = secrets.token_hex(16)
        connection.execute("UPDATE users SET username = ?, display_name = ?, password_hash = ?, password_salt = ?, role = ? WHERE id = ?", ("cndh", "Administrateur UDDH", password_hash("uddh", salt), salt, "admin", current_admin["id"]))
    elif not current_admin and not new_admin:
        salt = secrets.token_hex(16)
        connection.execute("INSERT INTO users (username, display_name, password_hash, password_salt, role) VALUES (?, ?, ?, ?, ?)", ("cndh", "Administrateur UDDH", password_hash("uddh", salt), salt, "admin"))
    connection.commit()
    return connection


def json_response(handler, payload, status=200):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def safe_filename(filename):
    filename = os.path.basename(filename or "image")
    return re.sub(r"[^A-Za-z0-9._-]", "-", filename)


def request_session(handler):
    request_cookies = cookies.SimpleCookie(handler.headers.get("Cookie", ""))
    session = request_cookies.get("uddh_session")
    return session.value if session else None


def authenticated(handler):
    return request_session(handler) in SESSIONS


def current_user(handler):
    return SESSIONS.get(request_session(handler))


def administrator(handler):
    user = current_user(handler)
    return user and user["role"] == "admin"


def unique_article_slug(connection, base_slug, exclude_id=None):
    slug = base_slug
    suffix = 2
    while True:
        if exclude_id is None:
            existing = connection.execute("SELECT 1 FROM articles WHERE slug = ?", (slug,)).fetchone()
        else:
            existing = connection.execute("SELECT 1 FROM articles WHERE slug = ? AND id != ?", (slug, exclude_id)).fetchone()
        if not existing:
            return slug
        slug = f"{base_slug}-{suffix}"
        suffix += 1


class UDDHHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        if path == "/admin" or path == "/admin/" or path == "/admin/index.html":
            if not authenticated(self):
                self.send_response(302)
                self.send_header("Location", "/admin/login.html")
                self.end_headers()
                return
        if path == "/api/media":
            with database() as connection:
                rows = connection.execute("SELECT media_key, file_url, original_name FROM media ORDER BY id DESC").fetchall()
            return json_response(self, {"media": [dict(row) for row in rows]})
        if path == "/api/dashboard/stats":
            if not authenticated(self):
                return json_response(self, {"error": "Authentification requise"}, 401)
            return self.dashboard_stats()
        if path == "/api/articles":
            with database() as connection:
                if authenticated(self):
                    rows = connection.execute("SELECT * FROM articles ORDER BY COALESCE(NULLIF(publication_date, ''), substr(created_at, 1, 10)) DESC, id DESC").fetchall()
                else:
                    rows = connection.execute("SELECT * FROM articles WHERE status IN ('publié', 'published') ORDER BY COALESCE(NULLIF(publication_date, ''), substr(created_at, 1, 10)) DESC, id DESC").fetchall()
            return json_response(self, {"articles": [dict(row) for row in rows]})
        if path.startswith("/api/articles/"):
            slug = path.rsplit("/", 1)[-1]
            with database() as connection:
                if authenticated(self):
                    row = connection.execute("SELECT * FROM articles WHERE slug = ?", (slug,)).fetchone()
                else:
                    row = connection.execute("SELECT * FROM articles WHERE slug = ? AND status IN ('publié', 'published')", (slug,)).fetchone()
            if not row:
                return json_response(self, {"error": "Article introuvable"}, 404)
            return json_response(self, {"article": dict(row)})
        if path == "/api/users":
            if not administrator(self):
                return json_response(self, {"error": "Droits administrateur requis"}, 403)
            with database() as connection:
                rows = connection.execute("SELECT id, username, display_name, role, created_at FROM users ORDER BY id").fetchall()
            return json_response(self, {"users": [dict(row) for row in rows]})
        if path == "/api/me":
            if not authenticated(self):
                return json_response(self, {"error": "Authentification requise"}, 401)
            return json_response(self, {"user": current_user(self)})
        if path == "/api/page":
            if not administrator(self):
                return json_response(self, {"error": "Droits administrateur requis"}, 403)
            filename = parse_qs(parsed_url.query).get("file", [""])[0]
            page_path = self.page_path(filename)
            if not page_path:
                return json_response(self, {"error": "Page invalide"}, 400)
            return json_response(self, {"file": filename, "content": page_path.read_text(encoding="utf-8")})
        if not path.startswith("/admin/") and path.endswith(".html"):
            page_path = (ROOT / path.lstrip("/")).resolve()
            if page_path.parent == ROOT and page_path.is_file():
                with database() as connection:
                    connection.execute("INSERT INTO site_visits (page_path) VALUES (?)", (path,))
                    connection.commit()
        return super().do_GET()

    def dashboard_stats(self):
        today = date.today()
        current_month = today.strftime("%Y-%m")
        months = []
        year, month = today.year, today.month
        for _ in range(6):
            months.append(f"{year:04d}-{month:02d}")
            month -= 1
            if month == 0:
                year -= 1
                month = 12
        months.reverse()
        with database() as connection:
            published = connection.execute("SELECT COUNT(*) FROM articles WHERE lower(status) IN ('publié', 'published')").fetchone()[0]
            drafts = connection.execute("SELECT COUNT(*) FROM articles WHERE lower(status) IN ('brouillon', 'draft')").fetchone()[0]
            visits = connection.execute("SELECT COUNT(*) FROM site_visits WHERE substr(created_at, 1, 7) = ?", (current_month,)).fetchone()[0]
            monthly_rows = connection.execute("SELECT substr(created_at, 1, 7) AS month, COUNT(*) AS total FROM site_visits WHERE substr(created_at, 1, 7) >= ? GROUP BY month", (months[0],)).fetchall()
            recent = connection.execute("SELECT title, slug, category, status, publication_date, updated_at FROM articles ORDER BY COALESCE(NULLIF(publication_date, ''), substr(created_at, 1, 10)) DESC, id DESC LIMIT 5").fetchall()
        media_count = sum(1 for folder in (ROOT / "images", UPLOAD_DIR) if folder.exists() for item in folder.rglob("*") if item.is_file() and item.suffix.lower() in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"})
        totals = {row["month"]: row["total"] for row in monthly_rows}
        french_months = ("janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc.")
        month_labels = [french_months[int(value[5:7]) - 1] for value in months]
        activity = [{"month": label, "visits": totals.get(value, 0)} for value, label in zip(months, month_labels)]
        return json_response(self, {"published": published, "drafts": drafts, "media": media_count, "monthly_visits": visits, "activity": activity, "recent_articles": [dict(row) for row in recent]})

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/login":
            return self.login()
        if path == "/api/logout":
            return self.logout()
        if not authenticated(self):
            return json_response(self, {"error": "Authentification requise"}, 401)
        if path == "/api/media/replace":
            return self.replace_media()
        if path == "/api/articles":
            return self.create_article()
        if path == "/api/articles/update":
            return self.update_article()
        if path == "/api/articles/delete":
            return self.delete_article()
        if path == "/api/users":
            if not administrator(self):
                return json_response(self, {"error": "Droits administrateur requis"}, 403)
            return self.create_user()
        if path == "/api/users/update":
            if not administrator(self):
                return json_response(self, {"error": "Droits administrateur requis"}, 403)
            return self.update_user()
        if path == "/api/password":
            return self.change_password()
        if path == "/api/page":
            if not administrator(self):
                return json_response(self, {"error": "Droits administrateur requis"}, 403)
            return self.save_page()
        return json_response(self, {"error": "Route introuvable"}, 404)

    def page_path(self, filename):
        if not filename or Path(filename).name != filename or not filename.endswith(".html"):
            return None
        page_path = (ROOT / filename).resolve()
        if page_path.parent != ROOT or not page_path.is_file():
            return None
        return page_path

    def save_page(self):
        length = int(self.headers.get("Content-Length", "0"))
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return json_response(self, {"error": "JSON invalide"}, 400)
        filename = str(data.get("file", ""))
        content = data.get("content")
        page_path = self.page_path(filename)
        if not page_path or not isinstance(content, str):
            return json_response(self, {"error": "Fichier ou contenu invalide"}, 400)
        backup_path = page_path.with_suffix(page_path.suffix + ".bak")
        backup_path.write_text(page_path.read_text(encoding="utf-8"), encoding="utf-8")
        page_path.write_text(content, encoding="utf-8")
        return json_response(self, {"saved": True, "file": filename, "backup": backup_path.name})

    def login(self):
        length = int(self.headers.get("Content-Length", "0"))
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return json_response(self, {"error": "JSON invalide"}, 400)
        username = str(data.get("username", "")).strip()
        with database() as connection:
            user = connection.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        if not user or not secrets.compare_digest(password_hash(str(data.get("password", "")), user["password_salt"]), user["password_hash"]):
            return json_response(self, {"error": "Identifiant ou mot de passe incorrect"}, 401)
        session = secrets.token_urlsafe(32)
        SESSIONS[session] = {"id": user["id"], "username": user["username"], "display_name": user["display_name"], "role": user["role"]}
        self.send_response(200)
        self.send_header("Set-Cookie", f"uddh_session={session}; HttpOnly; SameSite=Lax; Path=/")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(b'{"authenticated":true}')

    def logout(self):
        session = request_session(self)
        if session:
            SESSIONS.pop(session, None)
        self.send_response(200)
        self.send_header("Set-Cookie", "uddh_session=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(b'{"authenticated":false}')

    def create_user(self):
        length = int(self.headers.get("Content-Length", "0"))
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return json_response(self, {"error": "JSON invalide"}, 400)
        username = str(data.get("username", "")).strip().lower()
        display_name = str(data.get("display_name", "")).strip()
        password = str(data.get("password", ""))
        role = str(data.get("role", "editor")).strip().lower()
        if not re.fullmatch(r"[a-z0-9._-]{3,40}", username):
            return json_response(self, {"error": "Identifiant invalide (3 à 40 caractères)"}, 400)
        if len(password) < 8 or not display_name:
            return json_response(self, {"error": "Nom et mot de passe de 8 caractères minimum obligatoires"}, 400)
        if role not in ("admin", "editor"):
            return json_response(self, {"error": "Rôle invalide"}, 400)
        salt = secrets.token_hex(16)
        try:
            with database() as connection:
                cursor = connection.execute("INSERT INTO users (username, display_name, password_hash, password_salt, role) VALUES (?, ?, ?, ?, ?)", (username, display_name, password_hash(password, salt), salt, role))
                connection.commit()
                user = connection.execute("SELECT id, username, display_name, role, created_at FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
        except sqlite3.IntegrityError:
            return json_response(self, {"error": "Cet identifiant existe déjà"}, 409)
        return json_response(self, {"user": dict(user)}, 201)

    def update_user(self):
        length = int(self.headers.get("Content-Length", "0"))
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return json_response(self, {"error": "JSON invalide"}, 400)
        user_id = data.get("id")
        display_name = str(data.get("display_name", "")).strip()
        role = str(data.get("role", "editor")).strip().lower()
        new_password = str(data.get("password", ""))
        if not isinstance(user_id, int) or not display_name or role not in ("admin", "editor"):
            return json_response(self, {"error": "Données utilisateur invalides"}, 400)
        if new_password and len(new_password) < 8:
            return json_response(self, {"error": "Le mot de passe doit contenir au moins 8 caractères"}, 400)
        with database() as connection:
            existing = connection.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
            if not existing:
                return json_response(self, {"error": "Utilisateur introuvable"}, 404)
            if new_password:
                salt = secrets.token_hex(16)
                connection.execute("UPDATE users SET display_name = ?, role = ?, password_hash = ?, password_salt = ? WHERE id = ?", (display_name, role, password_hash(new_password, salt), salt, user_id))
            else:
                connection.execute("UPDATE users SET display_name = ?, role = ? WHERE id = ?", (display_name, role, user_id))
            connection.commit()
        return json_response(self, {"updated": True})

    def change_password(self):
        length = int(self.headers.get("Content-Length", "0"))
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return json_response(self, {"error": "JSON invalide"}, 400)
        user = current_user(self)
        current_password = str(data.get("current_password", ""))
        new_password = str(data.get("new_password", ""))
        with database() as connection:
            stored = connection.execute("SELECT password_hash, password_salt FROM users WHERE id = ?", (user["id"],)).fetchone()
            if not stored or not secrets.compare_digest(password_hash(current_password, stored["password_salt"]), stored["password_hash"]):
                return json_response(self, {"error": "Mot de passe actuel incorrect"}, 400)
            if len(new_password) < 8:
                return json_response(self, {"error": "Le nouveau mot de passe doit contenir au moins 8 caractères"}, 400)
            salt = secrets.token_hex(16)
            connection.execute("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?", (password_hash(new_password, salt), salt, user["id"]))
            connection.commit()
        return json_response(self, {"updated": True})

    def replace_media(self):
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            return json_response(self, {"error": "Le fichier doit être envoyé en multipart/form-data"}, 400)
        form = cgi.FieldStorage(fp=self.rfile, headers=self.headers, environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": content_type})
        media_key = form.getfirst("media_key", "").strip()
        upload = form["file"] if "file" in form else None
        if not media_key or not upload or not getattr(upload, "file", None):
            return json_response(self, {"error": "media_key et file sont obligatoires"}, 400)
        if not (upload.type or "").startswith("image/"):
            return json_response(self, {"error": "Seules les images sont autorisées"}, 400)
        UPLOAD_DIR.mkdir(exist_ok=True)
        filename = safe_filename(upload.filename)
        stored_name = f"{abs(hash(media_key))}-{filename}"
        target = UPLOAD_DIR / stored_name
        with target.open("wb") as destination:
            destination.write(upload.file.read())
        file_url = f"/uploads/{stored_name}"
        with database() as connection:
            connection.execute("""
                INSERT INTO media (media_key, file_url, original_name) VALUES (?, ?, ?)
                ON CONFLICT(media_key) DO UPDATE SET file_url=excluded.file_url, original_name=excluded.original_name
            """, (media_key, file_url, filename))
            connection.commit()
        return json_response(self, {"media_key": media_key, "file_url": file_url, "original_name": filename})

    def create_article(self):
        length = int(self.headers.get("Content-Length", "0"))
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return json_response(self, {"error": "JSON invalide"}, 400)
        title = str(data.get("title", "")).strip()
        category = str(data.get("category", "Actualités")).strip()
        status = str(data.get("status", "draft")).strip().lower()
        content = str(data.get("content", ""))
        featured_image = str(data.get("featured_image", "")).strip()
        publication_date = str(data.get("publication_date", "")).strip()
        base_slug = re.sub(r"[^a-z0-9-]", "", re.sub(r"\s+", "-", title.lower()))
        try:
            date.fromisoformat(publication_date)
        except ValueError:
            return json_response(self, {"error": "Choisissez une date de publication valide"}, 400)
        if not title or not base_slug:
            return json_response(self, {"error": "Le titre est obligatoire"}, 400)
        try:
            with database() as connection:
                slug = unique_article_slug(connection, base_slug)
                cursor = connection.execute("INSERT INTO articles (title, slug, category, status, content, featured_image, publication_date) VALUES (?, ?, ?, ?, ?, ?, ?)", (title, slug, category, status, content, featured_image, publication_date))
                connection.commit()
                article = connection.execute("SELECT * FROM articles WHERE id = ?", (cursor.lastrowid,)).fetchone()
        except sqlite3.IntegrityError:
            return json_response(self, {"error": "Un article avec ce titre existe déjà"}, 409)
        return json_response(self, {"article": dict(article)}, 201)

    def update_article(self):
        length = int(self.headers.get("Content-Length", "0"))
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return json_response(self, {"error": "JSON invalide"}, 400)
        article_id = data.get("id")
        title = str(data.get("title", "")).strip()
        category = str(data.get("category", "Actualités")).strip()
        status = str(data.get("status", "brouillon")).strip().lower()
        content = str(data.get("content", ""))
        featured_image = str(data.get("featured_image", "")).strip()
        publication_date = str(data.get("publication_date", "")).strip()
        base_slug = re.sub(r"[^a-z0-9-]", "", re.sub(r"\s+", "-", title.lower()))
        try:
            date.fromisoformat(publication_date)
        except ValueError:
            return json_response(self, {"error": "Choisissez une date de publication valide"}, 400)
        if not isinstance(article_id, int) or not title or not base_slug:
            return json_response(self, {"error": "Données de l'actualité invalides"}, 400)
        try:
            with database() as connection:
                existing = connection.execute("SELECT id FROM articles WHERE id = ?", (article_id,)).fetchone()
                if not existing:
                    return json_response(self, {"error": "Actualité introuvable"}, 404)
                slug = unique_article_slug(connection, base_slug, article_id)
                connection.execute("UPDATE articles SET title = ?, slug = ?, category = ?, status = ?, content = ?, featured_image = ?, publication_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (title, slug, category, status, content, featured_image, publication_date, article_id))
                connection.commit()
                article = connection.execute("SELECT * FROM articles WHERE id = ?", (article_id,)).fetchone()
        except sqlite3.IntegrityError:
            return json_response(self, {"error": "Une actualité avec ce titre existe déjà"}, 409)
        return json_response(self, {"article": dict(article)})

    def delete_article(self):
        length = int(self.headers.get("Content-Length", "0"))
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return json_response(self, {"error": "JSON invalide"}, 400)
        article_id = data.get("id")
        if not isinstance(article_id, int):
            return json_response(self, {"error": "Identifiant d'actualité invalide"}, 400)
        with database() as connection:
            cursor = connection.execute("DELETE FROM articles WHERE id = ?", (article_id,))
            connection.commit()
        if cursor.rowcount == 0:
            return json_response(self, {"error": "Actualité introuvable"}, 404)
        return json_response(self, {"deleted": True, "id": article_id})

    def log_message(self, format_string, *args):
        print(f"{self.address_string()} - {format_string % args}")


if __name__ == "__main__":
    database().close()
    print(f"UDDH est disponible sur http://localhost:{PORT}")
    ThreadingHTTPServer(("localhost", PORT), UDDHHandler).serve_forever()
