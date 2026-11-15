<?php
// Fonctions communes du backend PHP UDDH (remplace server.py)

define('ROOT_DIR', dirname(__DIR__));
define('DATA_DIR', ROOT_DIR . '/data');
define('UPLOAD_DIR', ROOT_DIR . '/uploads');
define('DB_PATH', DATA_DIR . '/uddh.sqlite3');

date_default_timezone_set('UTC'); // SQLite CURRENT_TIMESTAMP est en UTC

function start_session(): void
{
    if (session_status() === PHP_SESSION_NONE) {
        session_name('uddh_session');
        session_set_cookie_params(['path' => '/', 'httponly' => true, 'samesite' => 'Lax']);
        session_start();
    }
}

function password_hash_uddh(string $password, string $salt): string
{
    // Identique à hashlib.pbkdf2_hmac("sha256", ..., 120000).hex() en Python
    return hash_pbkdf2('sha256', $password, $salt, 120000, 64, false);
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) {
        return $pdo;
    }
    if (!is_dir(DATA_DIR)) {
        mkdir(DATA_DIR, 0775, true);
    }
    $pdo = new PDO('sqlite:' . DB_PATH);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

    $pdo->exec("CREATE TABLE IF NOT EXISTS media (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        media_key TEXT NOT NULL UNIQUE,
        file_url TEXT NOT NULL,
        original_name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    $pdo->exec("CREATE TABLE IF NOT EXISTS articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    $columns = array_column($pdo->query("PRAGMA table_info(articles)")->fetchAll(), 'name');
    if (!in_array('featured_image', $columns, true)) {
        $pdo->exec("ALTER TABLE articles ADD COLUMN featured_image TEXT NOT NULL DEFAULT ''");
    }
    if (!in_array('publication_date', $columns, true)) {
        $pdo->exec("ALTER TABLE articles ADD COLUMN publication_date TEXT NOT NULL DEFAULT ''");
    }
    $pdo->exec("UPDATE articles SET publication_date = substr(created_at, 1, 10) WHERE publication_date = ''");
    $pdo->exec("CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'editor',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    $pdo->exec("CREATE TABLE IF NOT EXISTS site_visits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");

    $find = $pdo->prepare("SELECT id FROM users WHERE username = ?");
    $find->execute(['admin']);
    $currentAdmin = $find->fetch();
    $find->execute(['cndh']);
    $newAdmin = $find->fetch();
    if ($currentAdmin && !$newAdmin) {
        $salt = bin2hex(random_bytes(16));
        $pdo->prepare("UPDATE users SET username = ?, display_name = ?, password_hash = ?, password_salt = ?, role = ? WHERE id = ?")
            ->execute(['cndh', 'Administrateur UDDH', password_hash_uddh('uddh', $salt), $salt, 'admin', $currentAdmin['id']]);
    } elseif (!$currentAdmin && !$newAdmin) {
        $salt = bin2hex(random_bytes(16));
        $pdo->prepare("INSERT INTO users (username, display_name, password_hash, password_salt, role) VALUES (?, ?, ?, ?, ?)")
            ->execute(['cndh', 'Administrateur UDDH', password_hash_uddh('uddh', $salt), $salt, 'admin']);
    }
    return $pdo;
}

function current_user(): ?array
{
    start_session();
    return $_SESSION['user'] ?? null;
}

function is_authenticated(): bool
{
    return current_user() !== null;
}

function is_admin(): bool
{
    $user = current_user();
    return $user && $user['role'] === 'admin';
}

function track_visit(string $path): void
{
    try {
        db()->prepare("INSERT INTO site_visits (page_path) VALUES (?)")->execute([$path]);
    } catch (Throwable $e) {
        // Ne jamais bloquer l'affichage d'une page pour une statistique
    }
}

/** Sert un fichier .html de la racine en enregistrant la visite. */
function serve_public_page(string $file): void
{
    $file = basename($file);
    $path = ROOT_DIR . '/' . $file;
    if (!preg_match('/^[A-Za-z0-9._-]+\.html$/', $file) || !is_file($path)) {
        http_response_code(404);
        echo 'Page introuvable';
        return;
    }
    track_visit('/' . $file);
    header('Content-Type: text/html; charset=utf-8');
    readfile($path);
}
