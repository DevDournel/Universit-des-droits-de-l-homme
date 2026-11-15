<?php
// Routeur pour tester en local : php -S localhost:8000 router.php
// (sur un hébergement Apache, c'est le fichier .htaccess qui fait ce travail)
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

if (preg_match('#^/(data|\.venv)(/|$)#', $path) || preg_match('#(server\.py|\.bak|/api/lib\.php)$#', $path)) {
    http_response_code(403);
    exit('Accès refusé');
}
if ($path === '/admin' || $path === '/admin/' || $path === '/admin/index.html') {
    require __DIR__ . '/api/admin.php';
    return true;
}
if (preg_match('#^/api(/|$)#', $path)) {
    require __DIR__ . '/api/index.php';
    return true;
}
if ($path === '/' || preg_match('#^/[A-Za-z0-9_-]+\.html$#', $path)) {
    $_GET['file'] = $path === '/' ? 'index.html' : ltrim($path, '/');
    require __DIR__ . '/api/page.php';
    return true;
}
return false; // CSS, JS, images : servis directement
