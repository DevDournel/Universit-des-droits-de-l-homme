<?php
// API JSON du site UDDH : toutes les routes /api/... arrivent ici.
require __DIR__ . '/lib.php';

function normalize_ids($value)
{
    // Les anciennes versions de PHP renvoient les entiers SQLite en texte ; le JS attend des nombres.
    if (is_array($value)) {
        foreach ($value as $key => $item) {
            $value[$key] = ($key === 'id' && is_string($item) && ctype_digit($item)) ? (int) $item : normalize_ids($item);
        }
    }
    return $value;
}

function json_response($payload, int $status = 200): void
{
    $payload = normalize_ids($payload);
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function json_body(): array
{
    $data = json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) {
        json_response(['error' => 'JSON invalide'], 400);
    }
    return $data;
}

function require_auth(): void
{
    if (!is_authenticated()) {
        json_response(['error' => 'Authentification requise'], 401);
    }
}

function require_admin(): void
{
    if (!is_admin()) {
        json_response(['error' => 'Droits administrateur requis'], 403);
    }
}

function make_slug(string $title): string
{
    $slug = preg_replace('/\s+/u', '-', mb_strtolower($title, 'UTF-8'));
    return preg_replace('/[^a-z0-9-]/', '', $slug);
}

function unique_article_slug(string $base, ?int $excludeId = null): string
{
    $slug = $base;
    $suffix = 2;
    while (true) {
        if ($excludeId === null) {
            $stmt = db()->prepare("SELECT 1 FROM articles WHERE slug = ?");
            $stmt->execute([$slug]);
        } else {
            $stmt = db()->prepare("SELECT 1 FROM articles WHERE slug = ? AND id != ?");
            $stmt->execute([$slug, $excludeId]);
        }
        if (!$stmt->fetch()) {
            return $slug;
        }
        $slug = $base . '-' . $suffix++;
    }
}

function valid_date(string $value): bool
{
    $d = DateTime::createFromFormat('!Y-m-d', $value);
    return $d && $d->format('Y-m-d') === $value;
}

function page_path(string $filename): ?string
{
    if ($filename === '' || basename($filename) !== $filename || !preg_match('/\.html$/', $filename)) {
        return null;
    }
    $path = ROOT_DIR . '/' . $filename;
    return is_file($path) ? $path : null;
}

function is_unique_violation(PDOException $e): bool
{
    return strpos($e->getMessage(), 'UNIQUE') !== false;
}

const ORDER_ARTICLES = "ORDER BY COALESCE(NULLIF(publication_date, ''), substr(created_at, 1, 10)) DESC, id DESC";

// ---------------------------------------------------------------------------

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$route = '/' . trim(preg_replace('#^.*?/api#', '', $path), '/'); // ex. "/articles/mon-slug"

if ($method === 'GET') {
    if ($route === '/media') {
        $rows = db()->query("SELECT media_key, file_url, original_name FROM media ORDER BY id DESC")->fetchAll();
        json_response(['media' => $rows]);
    }

    if ($route === '/dashboard/stats') {
        require_auth();
        $months = [];
        $cursor = new DateTime('first day of this month');
        for ($i = 0; $i < 6; $i++) {
            $months[] = $cursor->format('Y-m');
            $cursor->modify('-1 month');
        }
        $months = array_reverse($months);
        $pdo = db();
        $published = (int) $pdo->query("SELECT COUNT(*) FROM articles WHERE lower(status) IN ('publié', 'published')")->fetchColumn();
        $drafts = (int) $pdo->query("SELECT COUNT(*) FROM articles WHERE lower(status) IN ('brouillon', 'draft')")->fetchColumn();
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM site_visits WHERE substr(created_at, 1, 7) = ?");
        $stmt->execute([date('Y-m')]);
        $visits = (int) $stmt->fetchColumn();
        $stmt = $pdo->prepare("SELECT substr(created_at, 1, 7) AS month, COUNT(*) AS total FROM site_visits WHERE substr(created_at, 1, 7) >= ? GROUP BY month");
        $stmt->execute([$months[0]]);
        $totals = array_column($stmt->fetchAll(), 'total', 'month');
        $recent = $pdo->query("SELECT title, slug, category, status, publication_date, updated_at FROM articles " . ORDER_ARTICLES . " LIMIT 5")->fetchAll();

        $mediaCount = 0;
        foreach ([ROOT_DIR . '/images', UPLOAD_DIR] as $folder) {
            if (!is_dir($folder)) {
                continue;
            }
            $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($folder, FilesystemIterator::SKIP_DOTS));
            foreach ($it as $file) {
                if ($file->isFile() && in_array(strtolower($file->getExtension()), ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'], true)) {
                    $mediaCount++;
                }
            }
        }

        $frenchMonths = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
        $activity = [];
        foreach ($months as $m) {
            $activity[] = ['month' => $frenchMonths[(int) substr($m, 5, 2) - 1], 'visits' => (int) ($totals[$m] ?? 0)];
        }
        json_response([
            'published' => $published,
            'drafts' => $drafts,
            'media' => $mediaCount,
            'monthly_visits' => $visits,
            'activity' => $activity,
            'recent_articles' => $recent,
        ]);
    }

    if ($route === '/articles') {
        $where = is_authenticated() ? '' : "WHERE status IN ('publié', 'published') ";
        $rows = db()->query("SELECT * FROM articles " . $where . ORDER_ARTICLES)->fetchAll();
        json_response(['articles' => $rows]);
    }

    if (strpos($route, '/articles/') === 0) {
        $slug = urldecode(substr($route, strlen('/articles/')));
        $sql = "SELECT * FROM articles WHERE slug = ?" . (is_authenticated() ? '' : " AND status IN ('publié', 'published')");
        $stmt = db()->prepare($sql);
        $stmt->execute([$slug]);
        $row = $stmt->fetch();
        if (!$row) {
            json_response(['error' => 'Article introuvable'], 404);
        }
        json_response(['article' => $row]);
    }

    if ($route === '/users') {
        require_admin();
        $rows = db()->query("SELECT id, username, display_name, role, created_at FROM users ORDER BY id")->fetchAll();
        json_response(['users' => $rows]);
    }

    if ($route === '/me') {
        require_auth();
        json_response(['user' => current_user()]);
    }

    if ($route === '/page') {
        require_admin();
        $filename = $_GET['file'] ?? '';
        $p = page_path($filename);
        if (!$p) {
            json_response(['error' => 'Page invalide'], 400);
        }
        json_response(['file' => $filename, 'content' => file_get_contents($p)]);
    }

    json_response(['error' => 'Route introuvable'], 404);
}

if ($method !== 'POST') {
    json_response(['error' => 'Méthode non autorisée'], 405);
}

// ----------------------------- POST ----------------------------------------

if ($route === '/login') {
    $data = json_body();
    $username = trim((string) ($data['username'] ?? ''));
    $stmt = db()->prepare("SELECT * FROM users WHERE username = ?");
    $stmt->execute([$username]);
    $user = $stmt->fetch();
    if (!$user || !hash_equals($user['password_hash'], password_hash_uddh((string) ($data['password'] ?? ''), $user['password_salt']))) {
        json_response(['error' => 'Identifiant ou mot de passe incorrect'], 401);
    }
    start_session();
    session_regenerate_id(true);
    $_SESSION['user'] = [
        'id' => (int) $user['id'],
        'username' => $user['username'],
        'display_name' => $user['display_name'],
        'role' => $user['role'],
    ];
    json_response(['authenticated' => true]);
}

if ($route === '/logout') {
    start_session();
    $_SESSION = [];
    session_destroy();
    setcookie('uddh_session', '', ['expires' => time() - 3600, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax']);
    json_response(['authenticated' => false]);
}

require_auth();

if ($route === '/media/replace') {
    $mediaKey = trim((string) ($_POST['media_key'] ?? ''));
    $upload = $_FILES['file'] ?? null;
    if ($mediaKey === '' || !$upload || $upload['error'] !== UPLOAD_ERR_OK) {
        json_response(['error' => 'media_key et file sont obligatoires'], 400);
    }
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($upload['tmp_name']);
    if (strpos((string) $mime, 'image/') !== 0) {
        json_response(['error' => 'Seules les images sont autorisées'], 400);
    }
    if (!is_dir(UPLOAD_DIR)) {
        mkdir(UPLOAD_DIR, 0775, true);
    }
    $filename = preg_replace('/[^A-Za-z0-9._-]/', '-', basename($upload['name'] ?: 'image'));
    if (preg_match('/\.(php\d?|phtml|phar|html?|js|svg)$/i', $filename)) {
        json_response(['error' => 'Extension de fichier non autorisée'], 400);
    }
    $stored = sprintf('%u', crc32($mediaKey)) . '-' . $filename;
    move_uploaded_file($upload['tmp_name'], UPLOAD_DIR . '/' . $stored);
    $fileUrl = '/uploads/' . $stored;
    db()->prepare("INSERT INTO media (media_key, file_url, original_name) VALUES (?, ?, ?)
        ON CONFLICT(media_key) DO UPDATE SET file_url = excluded.file_url, original_name = excluded.original_name")
        ->execute([$mediaKey, $fileUrl, $filename]);
    json_response(['media_key' => $mediaKey, 'file_url' => $fileUrl, 'original_name' => $filename]);
}

if ($route === '/articles' || $route === '/articles/update') {
    $data = json_body();
    $isUpdate = $route === '/articles/update';
    $articleId = $data['id'] ?? null;
    $title = trim((string) ($data['title'] ?? ''));
    $category = trim((string) ($data['category'] ?? 'Actualités'));
    $status = mb_strtolower(trim((string) ($data['status'] ?? ($isUpdate ? 'brouillon' : 'draft'))), 'UTF-8');
    $content = (string) ($data['content'] ?? '');
    $featuredImage = trim((string) ($data['featured_image'] ?? ''));
    $publicationDate = trim((string) ($data['publication_date'] ?? ''));
    $baseSlug = make_slug($title);

    if (!valid_date($publicationDate)) {
        json_response(['error' => 'Choisissez une date de publication valide'], 400);
    }
    if ($isUpdate && (!is_int($articleId) || $title === '' || $baseSlug === '')) {
        json_response(['error' => "Données de l'actualité invalides"], 400);
    }
    if (!$isUpdate && ($title === '' || $baseSlug === '')) {
        json_response(['error' => 'Le titre est obligatoire'], 400);
    }

    $pdo = db();
    try {
        if ($isUpdate) {
            $stmt = $pdo->prepare("SELECT id FROM articles WHERE id = ?");
            $stmt->execute([$articleId]);
            if (!$stmt->fetch()) {
                json_response(['error' => 'Actualité introuvable'], 404);
            }
            $slug = unique_article_slug($baseSlug, $articleId);
            $pdo->prepare("UPDATE articles SET title = ?, slug = ?, category = ?, status = ?, content = ?, featured_image = ?, publication_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                ->execute([$title, $slug, $category, $status, $content, $featuredImage, $publicationDate, $articleId]);
            $id = $articleId;
        } else {
            $slug = unique_article_slug($baseSlug);
            $pdo->prepare("INSERT INTO articles (title, slug, category, status, content, featured_image, publication_date) VALUES (?, ?, ?, ?, ?, ?, ?)")
                ->execute([$title, $slug, $category, $status, $content, $featuredImage, $publicationDate]);
            $id = (int) $pdo->lastInsertId();
        }
    } catch (PDOException $e) {
        if (is_unique_violation($e)) {
            json_response(['error' => $isUpdate ? 'Une actualité avec ce titre existe déjà' : 'Un article avec ce titre existe déjà'], 409);
        }
        throw $e;
    }
    $stmt = $pdo->prepare("SELECT * FROM articles WHERE id = ?");
    $stmt->execute([$id]);
    json_response(['article' => $stmt->fetch()], $isUpdate ? 200 : 201);
}

if ($route === '/articles/delete') {
    $data = json_body();
    $articleId = $data['id'] ?? null;
    if (!is_int($articleId)) {
        json_response(['error' => "Identifiant d'actualité invalide"], 400);
    }
    $stmt = db()->prepare("DELETE FROM articles WHERE id = ?");
    $stmt->execute([$articleId]);
    if ($stmt->rowCount() === 0) {
        json_response(['error' => 'Actualité introuvable'], 404);
    }
    json_response(['deleted' => true, 'id' => $articleId]);
}

if ($route === '/users') {
    require_admin();
    $data = json_body();
    $username = mb_strtolower(trim((string) ($data['username'] ?? '')), 'UTF-8');
    $displayName = trim((string) ($data['display_name'] ?? ''));
    $password = (string) ($data['password'] ?? '');
    $role = strtolower(trim((string) ($data['role'] ?? 'editor')));
    if (!preg_match('/^[a-z0-9._-]{3,40}$/', $username)) {
        json_response(['error' => 'Identifiant invalide (3 à 40 caractères)'], 400);
    }
    if (mb_strlen($password) < 8 || $displayName === '') {
        json_response(['error' => 'Nom et mot de passe de 8 caractères minimum obligatoires'], 400);
    }
    if (!in_array($role, ['admin', 'editor'], true)) {
        json_response(['error' => 'Rôle invalide'], 400);
    }
    $salt = bin2hex(random_bytes(16));
    try {
        db()->prepare("INSERT INTO users (username, display_name, password_hash, password_salt, role) VALUES (?, ?, ?, ?, ?)")
            ->execute([$username, $displayName, password_hash_uddh($password, $salt), $salt, $role]);
    } catch (PDOException $e) {
        if (is_unique_violation($e)) {
            json_response(['error' => 'Cet identifiant existe déjà'], 409);
        }
        throw $e;
    }
    $stmt = db()->prepare("SELECT id, username, display_name, role, created_at FROM users WHERE id = ?");
    $stmt->execute([(int) db()->lastInsertId()]);
    json_response(['user' => $stmt->fetch()], 201);
}

if ($route === '/users/update') {
    require_admin();
    $data = json_body();
    $userId = $data['id'] ?? null;
    $displayName = trim((string) ($data['display_name'] ?? ''));
    $role = strtolower(trim((string) ($data['role'] ?? 'editor')));
    $newPassword = (string) ($data['password'] ?? '');
    if (!is_int($userId) || $displayName === '' || !in_array($role, ['admin', 'editor'], true)) {
        json_response(['error' => 'Données utilisateur invalides'], 400);
    }
    if ($newPassword !== '' && mb_strlen($newPassword) < 8) {
        json_response(['error' => 'Le mot de passe doit contenir au moins 8 caractères'], 400);
    }
    $stmt = db()->prepare("SELECT id FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    if (!$stmt->fetch()) {
        json_response(['error' => 'Utilisateur introuvable'], 404);
    }
    if ($newPassword !== '') {
        $salt = bin2hex(random_bytes(16));
        db()->prepare("UPDATE users SET display_name = ?, role = ?, password_hash = ?, password_salt = ? WHERE id = ?")
            ->execute([$displayName, $role, password_hash_uddh($newPassword, $salt), $salt, $userId]);
    } else {
        db()->prepare("UPDATE users SET display_name = ?, role = ? WHERE id = ?")->execute([$displayName, $role, $userId]);
    }
    json_response(['updated' => true]);
}

if ($route === '/password') {
    $data = json_body();
    $user = current_user();
    $stmt = db()->prepare("SELECT password_hash, password_salt FROM users WHERE id = ?");
    $stmt->execute([$user['id']]);
    $stored = $stmt->fetch();
    if (!$stored || !hash_equals($stored['password_hash'], password_hash_uddh((string) ($data['current_password'] ?? ''), $stored['password_salt']))) {
        json_response(['error' => 'Mot de passe actuel incorrect'], 400);
    }
    $newPassword = (string) ($data['new_password'] ?? '');
    if (mb_strlen($newPassword) < 8) {
        json_response(['error' => 'Le nouveau mot de passe doit contenir au moins 8 caractères'], 400);
    }
    $salt = bin2hex(random_bytes(16));
    db()->prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?")
        ->execute([password_hash_uddh($newPassword, $salt), $salt, $user['id']]);
    json_response(['updated' => true]);
}

if ($route === '/page') {
    require_admin();
    $data = json_body();
    $filename = (string) ($data['file'] ?? '');
    $content = $data['content'] ?? null;
    $p = page_path($filename);
    if (!$p || !is_string($content)) {
        json_response(['error' => 'Fichier ou contenu invalide'], 400);
    }
    copy($p, $p . '.bak');
    file_put_contents($p, $content);
    json_response(['saved' => true, 'file' => $filename, 'backup' => $filename . '.bak']);
}

json_response(['error' => 'Route introuvable'], 404);
