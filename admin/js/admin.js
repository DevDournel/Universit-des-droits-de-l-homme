document.addEventListener("DOMContentLoaded", () => {
  const links = document.querySelectorAll("[data-view]");
  const views = document.querySelectorAll(".view");
  const title = document.getElementById("view-title");
  const sidebar = document.getElementById("sidebar");
  let currentUser = null;
  const titles = { dashboard: "Tableau de bord", articles: "Articles", medias: "Médias", pages: "Pages", formations: "Formations", utilisateurs: "Utilisateurs", parametres: "Paramètres" };

  function showView(viewName) {
    views.forEach((view) => view.classList.toggle("active", view.id === `view-${viewName}`));
    document.querySelectorAll(".sidebar .nav-link").forEach((link) => link.classList.toggle("active", link.dataset.view === viewName));
    title.textContent = titles[viewName] || titles.dashboard;
    window.location.hash = viewName;
    sidebar.classList.remove("open");
  }

  links.forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); showView(link.dataset.view); }));
  document.getElementById("menu-toggle").addEventListener("click", () => sidebar.classList.toggle("open"));
  document.getElementById("logout-button").addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/admin/login.html";
  });
  showView(window.location.hash.slice(1) || "dashboard");

  const toast = new bootstrap.Toast(document.getElementById("admin-toast"), { delay: 2800 });
  const notify = (message) => { document.querySelector("#admin-toast span").textContent = message; toast.show(); };
  const articleForm = document.getElementById("article-form");
  const articleSubmitButton = document.querySelector('button[form="article-form"]');
  const saveDraftButton = document.createElement("button");
  saveDraftButton.className = "btn btn-outline-primary";
  saveDraftButton.type = "button";
  saveDraftButton.textContent = "Enregistrer en brouillon";
  articleSubmitButton.parentElement.insertBefore(saveDraftButton, articleSubmitButton);
  saveDraftButton.addEventListener("click", () => {
    document.getElementById("article-status").value = "Brouillon";
    articleForm.requestSubmit();
  });
  const publicationDateField = document.createElement("div");
  publicationDateField.className = "mt-3";
  publicationDateField.innerHTML = '<label class="form-label" for="article-publication-date">Date de publication</label><input class="form-control" id="article-publication-date" type="date" required>';
  articleForm.insertBefore(publicationDateField, document.getElementById("article-featured-image").closest(".mt-3"));
  const featuredImageSelect = document.getElementById("article-featured-image");
  const featuredImagePreview = document.createElement("img");
  featuredImagePreview.className = "featured-image-preview";
  featuredImagePreview.alt = "Aperçu de la photo mise en avant";
  featuredImagePreview.hidden = true;
  featuredImageSelect.parentElement.insertBefore(featuredImagePreview, featuredImageSelect.nextElementSibling);
  const updateFeaturedImagePreview = () => {
    const source = featuredImageSelect.value;
    featuredImagePreview.hidden = !source;
    if (source) featuredImagePreview.src = `../${source}`;
  };
  featuredImageSelect.addEventListener("change", updateFeaturedImagePreview);
  const todayAsIso = () => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  };
  const formatPublicationDate = (value) => {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString("fr-FR");
  };
  const loadDashboardStats = async () => {
    try {
      const response = await fetch("/api/dashboard/stats", { headers: { Accept: "application/json" } });
      if (response.status === 401) {
        window.location.href = "/admin/login.html";
        return;
      }
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error(`Réponse invalide du serveur (HTTP ${response.status}).`);
      }
      const stats = await response.json();
      if (!response.ok) throw new Error(stats.error || "Erreur serveur");
      const cards = document.querySelectorAll("#view-dashboard .stats-grid .stat-card");
      [stats.published, stats.media, stats.monthly_visits, stats.drafts].forEach((value, index) => {
        cards[index].querySelector("strong").textContent = Number(value).toLocaleString("fr-FR");
      });
      cards[0].querySelector("small").textContent = "En ligne sur le site";
      cards[1].querySelector("small").textContent = "Fichiers image présents";
      cards[2].querySelector("small").textContent = "Pages publiques consultées";
      cards[3].querySelector("small").textContent = "À relire";

      const labels = document.querySelector(".chart-labels");
      const yAxis = document.querySelectorAll(".chart-y span");
      const line = document.querySelector(".chart .line");
      const area = document.querySelector(".chart .area-fill");
      const activity = stats.activity || [];
      const maxVisits = Math.max(1, ...activity.map((item) => item.visits));
      const points = activity.map((item, index) => ({ x: activity.length < 2 ? 350 : index * 700 / (activity.length - 1), y: 205 - item.visits / maxVisits * 180 }));
      const linePath = points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ");
      line.setAttribute("d", linePath || "M0 205 L700 205");
      area.setAttribute("d", points.length ? `${linePath} L${points[points.length - 1].x} 220 L${points[0].x} 220 Z` : "M0 220 L700 220 Z");
      labels.replaceChildren(...activity.map((item) => { const label = document.createElement("span"); label.textContent = item.month; return label; }));
      yAxis.forEach((label, index) => { label.textContent = Math.round(maxVisits * (4 - index) / 4).toLocaleString("fr-FR"); });

      const recentBody = document.querySelector("#view-dashboard .panel.mt-4 tbody");
      document.querySelector("#view-dashboard .panel.mt-4 thead").innerHTML = "<tr><th>Actualité</th><th>Catégorie</th><th>Statut</th><th>Date de publication</th><th></th></tr>";
      recentBody.innerHTML = (stats.recent_articles || []).map((article) => `<tr><td><strong>${escapeHtml(article.title)}</strong><small>${escapeHtml(article.slug)}</small></td><td>${escapeHtml(article.category)}</td><td><span class="status ${article.status === "publié" || article.status === "published" ? "published" : "draft"}">${article.status === "publié" || article.status === "published" ? "Publié" : "Brouillon"}</span></td><td>${formatPublicationDate(article.publication_date || article.updated_at.slice(0, 10))}</td><td><button class="row-action" type="button" data-view="articles" title="Gérer l'actualité"><i class="bi bi-arrow-right"></i></button></td></tr>`).join("") || '<tr><td colspan="5" class="text-muted">Aucune actualité enregistrée.</td></tr>';
      recentBody.querySelectorAll('[data-view="articles"]').forEach((button) => button.addEventListener("click", () => showView("articles")));
    } catch (error) {
      notify(`Impossible de charger les statistiques : ${error.message}`);
    }
  };
  const loadCurrentUser = async () => {
    const response = await fetch("/api/me");
    if (!response.ok) return;
    const result = await response.json();
    currentUser = result.user;
    document.querySelector(".user-menu .d-none.d-sm-inline").textContent = currentUser.display_name;
    document.querySelectorAll("[data-admin-only]").forEach((element) => { element.hidden = currentUser.role !== "admin"; });
    if (currentUser.role !== "admin" && ["pages", "formations", "utilisateurs", "parametres"].includes(window.location.hash.slice(1))) showView("dashboard");
  };
  loadCurrentUser();
  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  const loadArticles = async () => {
    const response = await fetch("/api/articles");
    const result = await response.json();
    const body = document.querySelector("#articles-table tbody");
    if (!response.ok) { body.innerHTML = `<tr><td colspan="5" class="text-danger">${escapeHtml(result.error)}</td></tr>`; return; }
    document.querySelector("#articles-table thead th:nth-child(4)").textContent = "Date de publication";
    body.innerHTML = result.articles.map((article) => `<tr><td><strong>${escapeHtml(article.title)}</strong><small>${escapeHtml(article.slug)}</small></td><td>${escapeHtml(article.category)}</td><td><span class="status ${article.status === "publié" || article.status === "published" ? "published" : "draft"}">${article.status === "publié" || article.status === "published" ? "Publié" : "Brouillon"}</span></td><td>${formatPublicationDate(article.publication_date || article.created_at.slice(0, 10))}</td><td>${article.featured_image ? '<i class="bi bi-image text-primary me-2" title="Photo mise en avant"></i>' : ""}<button class="btn btn-sm btn-light edit-article" data-article-id="${article.id}" title="Modifier"><i class="bi bi-pencil"></i></button> <button class="btn btn-sm btn-light text-danger delete-article" data-article-id="${article.id}" title="Supprimer"><i class="bi bi-trash"></i></button></td></tr>`).join("");
    body.querySelectorAll(".edit-article").forEach((button) => button.addEventListener("click", () => {
      const article = result.articles.find((item) => item.id === Number(button.dataset.articleId));
      document.getElementById("articleModalLabel").textContent = "Modifier l'actualité";
      document.getElementById("article-title").value = article.title;
      document.getElementById("article-category").value = article.category;
      document.getElementById("article-status").value = article.status === "publié" ? "Publié" : "Brouillon";
      document.getElementById("article-publication-date").value = article.publication_date || article.created_at.slice(0, 10);
      document.getElementById("article-featured-image").value = article.featured_image || "";
      updateFeaturedImagePreview();
      document.getElementById("article-content").value = article.content || "";
      document.getElementById("article-form").dataset.editingId = article.id;
      new bootstrap.Modal(document.getElementById("articleModal")).show();
    }));
    body.querySelectorAll(".delete-article").forEach((button) => button.addEventListener("click", async () => {
      const article = result.articles.find((item) => item.id === Number(button.dataset.articleId));
      if (!window.confirm(`Supprimer définitivement l'actualité « ${article.title} » ?`)) return;
      try {
        const deletionResponse = await fetch("/api/articles/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: article.id }) });
        const deletion = await deletionResponse.json();
        if (!deletionResponse.ok) throw new Error(deletion.error || "Erreur serveur");
        await loadArticles();
        await loadDashboardStats();
        notify("Actualité supprimée.");
      } catch (error) {
        notify(`Impossible de supprimer l'actualité : ${error.message}`);
      }
    }));
  };
  const loadUsers = async () => {
    const response = await fetch("/api/users");
    const result = await response.json();
    const body = document.querySelector("#users-table tbody");
    if (!response.ok) { body.innerHTML = `<tr><td colspan="4" class="text-danger">${result.error}</td></tr>`; return; }
    body.innerHTML = result.users.map((user) => `<tr><td><strong>${escapeHtml(user.display_name)}</strong></td><td>${escapeHtml(user.username)}</td><td><span class="status ${user.role === "admin" ? "published" : "draft"}">${user.role === "admin" ? "Administrateur" : "Éditeur"}</span></td><td>${new Date(`${user.created_at.replace(" ", "T")}Z`).toLocaleDateString("fr-FR")}</td><td><button class="btn btn-sm btn-light edit-user" type="button" data-user-id="${user.id}" title="Modifier"><i class="bi bi-pencil"></i></button></td></tr>`).join("");
    body.querySelectorAll(".edit-user").forEach((button) => button.addEventListener("click", () => {
      const user = result.users.find((item) => item.id === Number(button.dataset.userId));
      document.getElementById("edit-user-id").value = user.id;
      document.getElementById("edit-user-username").textContent = `Identifiant : ${user.username}`;
      document.getElementById("edit-user-display-name").value = user.display_name;
      document.getElementById("edit-user-role").value = user.role;
      document.getElementById("edit-user-password").value = "";
      new bootstrap.Modal(document.getElementById("editUserModal")).show();
    }));
  };
  let pageBeingEdited = "";
  const pageModal = new bootstrap.Modal(document.getElementById("pageEditorModal"));
  const openPageEditor = async (filename) => {
    try {
      const response = await fetch(`/api/page?file=${encodeURIComponent(filename)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Accès refusé");
      pageBeingEdited = filename;
      document.getElementById("page-editor-file").textContent = filename;
      document.getElementById("page-editor-content").value = result.content;
      pageModal.show();
    } catch (error) {
      notify(`Impossible d'ouvrir la page : ${error.message}`);
    }
  };
  document.querySelectorAll("#pages-table tbody tr").forEach((row) => {
    const filename = row.cells[1].textContent.trim();
    const actions = row.cells[3];
    const editButton = document.createElement("button");
    editButton.className = "btn btn-sm btn-light ms-1";
    editButton.type = "button";
    editButton.title = "Modifier le code";
    editButton.innerHTML = '<i class="bi bi-code-slash"></i>';
    editButton.addEventListener("click", () => openPageEditor(filename));
    actions.appendChild(editButton);
  });
  document.getElementById("save-page-button").addEventListener("click", async () => {
    const content = document.getElementById("page-editor-content").value;
    try {
      const response = await fetch("/api/page", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: pageBeingEdited, content }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Erreur serveur");
      pageModal.hide();
      notify(`Page enregistrée. Sauvegarde créée : ${result.backup}`);
    } catch (error) {
      notify(`Impossible d'enregistrer la page : ${error.message}`);
    }
  });
  document.getElementById("user-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = { display_name: document.getElementById("user-display-name").value, username: document.getElementById("user-username").value, password: document.getElementById("user-password").value, role: document.getElementById("user-role").value };
    try {
      const response = await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Erreur serveur");
      bootstrap.Modal.getInstance(document.getElementById("userModal")).hide();
      event.target.reset();
      await loadUsers();
      notify("Utilisateur créé avec succès.");
    } catch (error) {
      notify(`Impossible de créer l'utilisateur : ${error.message}`);
    }
  });
  document.getElementById("edit-user-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = { id: Number(document.getElementById("edit-user-id").value), display_name: document.getElementById("edit-user-display-name").value, password: document.getElementById("edit-user-password").value, role: document.getElementById("edit-user-role").value };
    try {
      const response = await fetch("/api/users/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Erreur serveur");
      bootstrap.Modal.getInstance(document.getElementById("editUserModal")).hide();
      await loadUsers();
      notify("Utilisateur modifié avec succès.");
    } catch (error) {
      notify(`Impossible de modifier l'utilisateur : ${error.message}`);
    }
  });
  document.getElementById("change-password-button").addEventListener("click", () => new bootstrap.Modal(document.getElementById("passwordModal")).show());
  document.getElementById("password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const response = await fetch("/api/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current_password: document.getElementById("current-password").value, new_password: document.getElementById("new-password").value }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Erreur serveur");
      bootstrap.Modal.getInstance(document.getElementById("passwordModal")).hide();
      event.target.reset();
      notify("Votre mot de passe a été modifié.");
    } catch (error) {
      notify(`Impossible de modifier le mot de passe : ${error.message}`);
    }
  });
  document.getElementById("article-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      title: document.getElementById("article-title").value,
      category: document.getElementById("article-category").value,
      status: document.getElementById("article-status").value,
      publication_date: document.getElementById("article-publication-date").value,
      featured_image: document.getElementById("article-featured-image").value,
      content: document.getElementById("article-content").value
    };
    try {
      const editingId = event.target.dataset.editingId;
      const isDraft = payload.status.toLowerCase() === "brouillon" || payload.status.toLowerCase() === "draft";
      if (editingId) payload.id = Number(editingId);
      const response = await fetch(editingId ? "/api/articles/update" : "/api/articles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Erreur serveur");
      bootstrap.Modal.getInstance(document.getElementById("articleModal")).hide();
      await loadArticles();
      await loadDashboardStats();
      document.getElementById("articleModalLabel").textContent = "Créer une actualité";
      delete event.target.dataset.editingId;
      notify(isDraft ? "Brouillon enregistré. Vous pourrez le reprendre depuis la liste des actualités." : editingId ? "Actualité modifiée et publiée." : "Actualité publiée.");
      event.target.reset();
    } catch (error) {
      notify(`Impossible d'enregistrer : ${error.message}`);
    }
  });
  document.querySelector('[data-bs-target="#articleModal"]').addEventListener("click", () => {
    document.getElementById("articleModalLabel").textContent = "Créer une actualité";
    delete document.getElementById("article-form").dataset.editingId;
    document.getElementById("article-form").reset();
    document.getElementById("article-publication-date").value = todayAsIso();
    updateFeaturedImagePreview();
  });

  const uploadInput = document.getElementById("media-upload");
  let mediaToReplace = null;
  document.getElementById("upload-trigger").addEventListener("click", () => { mediaToReplace = null; uploadInput.click(); });
  document.querySelectorAll(".media-replace").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      mediaToReplace = button.closest(".media-card");
      uploadInput.click();
    });
  });
  uploadInput.addEventListener("change", () => {
    const file = uploadInput.files[0];
    if (!file) return;
    if (!mediaToReplace) { notify("Média sélectionné. Choisissez une vignette pour le remplacer."); return; }
    const formData = new FormData();
    formData.append("media_key", mediaToReplace.dataset.media);
    formData.append("file", file);
    fetch("/api/media/replace", { method: "POST", body: formData })
      .then((response) => response.json().then((result) => ({ response, result })))
      .then(async ({ response, result }) => {
        if (!response.ok) throw new Error(result.error || "Erreur serveur");
        window.uddhMedia.setOverride(result.media_key, result.file_url);
        window.uddhMedia.apply();
        await loadDashboardStats();
        notify("Média enregistré et appliqué aux pages associées.");
        mediaToReplace = null;
        uploadInput.value = "";
      })
      .catch((error) => notify(`Impossible d'envoyer le média : ${error.message}`));
  });

  const filterArticles = () => {
    const search = document.getElementById("article-search").value.toLowerCase();
    const status = document.querySelector("#view-articles .filter-select").value.toLowerCase();
    document.querySelectorAll("#articles-table tbody tr").forEach((row) => {
      const matchesSearch = row.textContent.toLowerCase().includes(search);
      const matchesStatus = status === "tous les statuts" || row.textContent.toLowerCase().includes(status);
      row.hidden = !matchesSearch || !matchesStatus;
    });
  };
  document.getElementById("article-search").addEventListener("input", filterArticles);
  document.querySelector("#view-articles .filter-select").addEventListener("change", filterArticles);
  document.getElementById("media-search").addEventListener("input", (event) => { document.querySelectorAll(".media-card").forEach((card) => { card.hidden = !card.dataset.name.includes(event.target.value.toLowerCase()); }); });
  document.getElementById("page-search").addEventListener("input", (event) => { document.querySelectorAll("#pages-table tbody tr").forEach((row) => { row.hidden = !row.textContent.toLowerCase().includes(event.target.value.toLowerCase()); }); });
  loadArticles();
  loadDashboardStats();
  document.querySelector('[data-view="dashboard"]').addEventListener("click", loadDashboardStats);
  document.querySelector('[data-view="articles"]').addEventListener("click", loadArticles);
  if (window.location.hash.slice(1) === "utilisateurs") loadUsers();
  document.querySelector('[data-view="utilisateurs"]').addEventListener("click", loadUsers);
});