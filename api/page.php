<?php
// Sert une page .html publique en comptant la visite (statistiques du tableau de bord).
require __DIR__ . '/lib.php';
serve_public_page($_GET['file'] ?? 'index.html');
