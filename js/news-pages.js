if (window.location.port === "5500") {
  window.location.replace("http://localhost:8000" + window.location.pathname + window.location.search + window.location.hash);
} else {
  document.addEventListener("DOMContentLoaded", function () {
  var grid = document.getElementById("news-grid");
  var reader = document.getElementById("article-reader");
  if (grid) loadNewsGrid(grid);
  if (reader) loadArticle(reader);
  });
}

var newsPageSize = 6;
var newsArticles = [];
var newsPage = 1;

function initNewsCarousel() {
  var grid = document.getElementById("news-grid");
  var viewport = document.querySelector(".news-carousel-viewport");
  var previous = document.querySelector(".news-carousel-prev");
  var next = document.querySelector(".news-carousel-next");
  if (!grid || !viewport || !previous || !next) return;
  previous.addEventListener("click", function () { viewport.scrollBy({ left: -viewport.clientWidth, behavior: "smooth" }); });
  next.addEventListener("click", function () { viewport.scrollBy({ left: viewport.clientWidth, behavior: "smooth" }); });
}

function articleImage(article) {
  return article.featured_image || "";
}

function createNewsCard(article) {
  var card = document.createElement("article");
  var link = document.createElement("a");
  var body = document.createElement("div");
  var category = document.createElement("span");
  var title = document.createElement("h3");
  var excerpt = document.createElement("p");
  var action = document.createElement("span");
  var image = articleImage(article);

  card.className = "news-grid-card";
  link.className = "news-grid-link";
  link.href = "article.html?slug=" + encodeURIComponent(article.slug);
  var media = document.createElement("img");
  var date = document.createElement("span");
  media.className = "news-grid-image";
  media.src = image || "images/galerie/galerie-2.jpg";
  media.alt = article.title;
  date.className = "news-date";
  var publicationDate = article.publication_date || article.created_at.slice(0, 10);
  var dateParts = publicationDate.split("-").map(Number);
  date.textContent = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  link.append(media, date);
  body.className = "news-grid-body";
  category.className = "news-card-category";
  category.textContent = article.category;
  title.textContent = article.title;
  var excerptText = String(article.content || "").replace(/\s+/g, " ").trim();
  excerpt.textContent = excerptText ? excerptText.slice(0, 135) + (excerptText.length > 135 ? "…" : "") : "Découvrez les dernières informations et activités de l'UDDH.";
  action.className = "news-card-link";
  action.textContent = "Lire la suite →";
  body.append(category, title, excerpt, action);
  link.appendChild(body);
  card.appendChild(link);
  return card;
}

function loadNewsGrid(grid) {
  fetch("/api/articles")
    .then(function (response) { return response.ok ? response.json() : Promise.reject(new Error("Impossible de charger les actualités")); })
    .then(function (payload) {
      grid.replaceChildren();
      if (!payload.articles.length) {
        var empty = document.createElement("p");
        empty.className = "news-empty";
        empty.textContent = "Aucune actualité publiée pour le moment.";
        grid.appendChild(empty);
        return;
      }
      newsArticles = payload.articles;
      renderNewsPage(grid);
    })
    .catch(function () {
      grid.replaceChildren();
      var error = document.createElement("p");
      error.className = "news-empty";
      error.textContent = "Les actualités seront bientôt disponibles.";
      grid.appendChild(error);
    });
}

function renderNewsPage(grid) {
  var start = (newsPage - 1) * newsPageSize;
  grid.replaceChildren();
  newsArticles.slice(start, start + newsPageSize).forEach(function (article) { grid.appendChild(createNewsCard(article)); });
  renderNewsPagination(grid);
}

function renderNewsPagination(grid) {
  var pagination = document.getElementById("news-pagination");
  if (!pagination) return;
  pagination.replaceChildren();
  var totalPages = Math.ceil(newsArticles.length / newsPageSize);
  if (totalPages < 2) return;
  var previous = document.createElement("button");
  previous.textContent = "‹";
  previous.disabled = newsPage === 1;
  previous.addEventListener("click", function () { newsPage--; renderNewsPage(grid); });
  pagination.appendChild(previous);
  for (var page = 1; page <= totalPages; page++) {
    var button = document.createElement("button");
    button.textContent = page;
    button.className = page === newsPage ? "is-active" : "";
    button.addEventListener("click", (function (selectedPage) { return function () { newsPage = selectedPage; renderNewsPage(grid); }; }(page)));
    pagination.appendChild(button);
  }
  var next = document.createElement("button");
  next.textContent = "›";
  next.disabled = newsPage === totalPages;
  next.addEventListener("click", function () { newsPage++; renderNewsPage(grid); });
  pagination.appendChild(next);
}

function loadArticle(reader) {
  var slug = new URLSearchParams(window.location.search).get("slug");
  if (!slug) {
    reader.innerHTML = "<p class=\"news-empty\">Article introuvable.</p>";
    return;
  }
  fetch("/api/articles/" + encodeURIComponent(slug))
    .then(function (response) { return response.ok ? response.json() : Promise.reject(new Error("Article introuvable")); })
    .then(function (payload) {
      var article = payload.article;
      reader.replaceChildren();
      var category = document.createElement("p");
      var title = document.createElement("h1");
      var date = document.createElement("p");
      var content = document.createElement("div");
      var back = document.createElement("a");
      category.className = "eyebrow";
      category.textContent = article.category;
      title.textContent = article.title;
      date.className = "article-date";
      date.textContent = new Date(article.updated_at.replace(" ", "T") + "Z").toLocaleDateString("fr-FR");
      content.className = "article-content";
      String(article.content || "").split(/\n\s*\n/).filter(Boolean).forEach(function (paragraph) {
        var element = document.createElement("p");
        element.textContent = paragraph;
        content.appendChild(element);
      });
      if (!content.children.length) content.textContent = "Retrouvez les informations de l'UDDH dans cet article.";
      back.className = "btn btn-outline-dark article-back";
      back.href = "actualites.html";
      back.textContent = "← Retour aux actualités";
      if (articleImage(article)) {
        var image = document.createElement("img");
        image.className = "article-featured-image";
        image.src = articleImage(article);
        image.alt = article.title;
        reader.append(category, title, date, image, content, back);
      } else {
        reader.append(category, title, date, content, back);
      }
    })
    .catch(function () { reader.innerHTML = "<p class=\"news-empty\">Article introuvable.</p>"; });
}
