<?php
// Protège admin/index.html : redirige vers la page de connexion si non connecté.
require __DIR__ . '/lib.php';
if (!is_authenticated()) {
    header('Location: /admin/login.html', true, 302);
    exit;
}
header('Content-Type: text/html; charset=utf-8');
readfile(ROOT_DIR . '/admin/index.html');
