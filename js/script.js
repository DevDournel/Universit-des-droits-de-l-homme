/* =========================================================
   UDDH — script.js
   JavaScript vanilla uniquement (pas de bibliothèque)
   ========================================================= */

/* Numéro WhatsApp — remplacer NUMERO_UDDH par le numéro officiel
   (indicatif pays sans +, ex. 225XXXXXXXXX) */
const whatsappNumber = "NUMERO_UDDH";

const whatsappMessage =
  "Bonjour, je souhaite obtenir des informations sur les formations de l'UDDH.";

function getWhatsAppUrl() {
  return (
    "https://wa.me/" +
    whatsappNumber +
    "?text=" +
    encodeURIComponent(whatsappMessage)
  );
}

/* Tous les liens avec data-whatsapp ouvrent WhatsApp */
function initWhatsAppLinks() {
  const url = getWhatsAppUrl();
  document.querySelectorAll("[data-whatsapp]").forEach(function (el) {
    el.setAttribute("href", url);
    el.setAttribute("target", "_blank");
    el.setAttribute("rel", "noopener noreferrer");
  });
}

function initHeader() {
  var header = document.querySelector(".site-header");
  var toggle = document.querySelector(".nav-toggle");
  var dropdowns = document.querySelectorAll(".has-dropdown");

  if (toggle && header) {
    toggle.addEventListener("click", function () {
      var open = header.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.classList.toggle("nav-lock", open);
    });
  }

  /* Accordéons de navigation sur mobile / clic */
  dropdowns.forEach(function (dropdown) {
    var dropdownBtn = dropdown.querySelector(".dropdown-toggle");
    if (!dropdownBtn) return;

    dropdownBtn.addEventListener("click", function (e) {
      if (window.matchMedia("(max-width: 992px)").matches) {
        e.preventDefault();
        var open = dropdown.classList.toggle("is-open");
        dropdownBtn.setAttribute("aria-expanded", open ? "true" : "false");
      }
    });
  });

  document.querySelectorAll(".main-nav a:not(.dropdown-toggle)").forEach(function (link) {
    link.addEventListener("click", function () {
      if (!header) return;
      header.classList.remove("is-open");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
      document.body.classList.remove("nav-lock");
    });
  });
}

function initHeaderScroll() {
  var header = document.querySelector(".site-header");
  if (!header) return;

  function onScroll() {
    header.classList.toggle("is-scrolled", window.scrollY > 16);
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

/* Apparition douce des sections */
function initScrollReveal() {
  var els = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    els.forEach(function (el) {
      el.classList.add("is-visible");
    });
    return;
  }

  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );

  els.forEach(function (el) {
    io.observe(el);
  });
}

function initNewsMarquee() {
  var track = document.getElementById("news-track");
  if (!track || !window.fetch) return;

  function duplicateCards() {
    if (track.dataset.duplicated) return;
    Array.prototype.slice.call(track.children).forEach(function (card) {
      var clone = card.cloneNode(true);
      clone.setAttribute("aria-hidden", "true");
      track.appendChild(clone);
    });
    track.dataset.duplicated = "true";
  }

  fetch("/api/articles")
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (payload) {
      if (!payload || !payload.articles || !payload.articles.length) {
        duplicateCards();
        return;
      }
      var articles = payload.articles.filter(function (article) { return article.status === "publié" || article.status === "published"; });
      if (!articles.length) {
        duplicateCards();
        return;
      }
      var cards = articles.map(function (article) {
        var card = document.createElement("a");
          var image = document.createElement("img");
        var category = document.createElement("span");
        var title = document.createElement("h3");
        var excerpt = document.createElement("p");
        var link = document.createElement("span");
        card.className = "news-card";
        card.href = "article.html?slug=" + encodeURIComponent(article.slug);
        if (article.featured_image) {
          image.className = "news-card-image";
          image.src = article.featured_image;
          image.alt = article.title;
          card.appendChild(image);
        }
        category.className = "news-card-category";
        category.textContent = article.category;
        title.textContent = article.title;
        excerpt.textContent = "Découvrez les dernières informations et activités de l'UDDH.";
        link.className = "news-card-link";
        link.textContent = "Lire l'article →";
        card.append(category, title, excerpt, link);
        return card;
      });
      track.replaceChildren.apply(track, cards);
      track.removeAttribute("data-duplicated");
      duplicateCards();
    })
    .catch(function () {
      duplicateCards();
    });
}

function initNewsTicker() {
  var ticker = document.createElement("aside");
  var label = document.createElement("span");
  var icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  var iconCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  var iconLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
  var iconDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  var viewport = document.createElement("div");
  var track = document.createElement("div");

  ticker.className = "news-ticker";
  ticker.setAttribute("aria-label", "Dernières actualités");
  label.className = "news-ticker-label";
  label.setAttribute("aria-label", "Information");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  iconCircle.setAttribute("cx", "12");
  iconCircle.setAttribute("cy", "12");
  iconCircle.setAttribute("r", "9");
  iconLine.setAttribute("x1", "12");
  iconLine.setAttribute("y1", "11");
  iconLine.setAttribute("x2", "12");
  iconLine.setAttribute("y2", "16");
  iconDot.setAttribute("cx", "12");
  iconDot.setAttribute("cy", "7.5");
  iconDot.setAttribute("r", "0.75");
  icon.append(iconCircle, iconLine, iconDot);
  label.appendChild(icon);

  viewport.className = "news-ticker-viewport";
  track.className = "news-ticker-track";
  viewport.appendChild(track);
  ticker.append(label, viewport);
  var header = document.querySelector(".site-header");
  if (header) {
    header.parentNode.insertBefore(ticker, header);
  } else {
    document.body.appendChild(ticker);
  }

  function updateTicker(articles) {
    function createGroup(items, isClone) {
      var group = document.createElement("div");
      group.className = "news-ticker-group";
      if (isClone) group.setAttribute("aria-hidden", "true");

      items.forEach(function (item) {
        var link = document.createElement("a");
        link.className = "news-ticker-item";
        link.href = item.href;
        link.textContent = item.title;
        if (isClone) link.tabIndex = -1;
        group.appendChild(link);
      });
      return group;
    }

    var group = createGroup(articles, false);
    var cloneGroup = createGroup(articles, true);
    track.replaceChildren(group, cloneGroup);
  }

  updateTicker([
    { href: "actualites.html", title: "Consultez les dernières actualités de l'UDDH" },
    { href: "formations.html", title: "Découvrez les formations en droits humains" },
    { href: "galerie.html", title: "Retrouvez les activités et événements de l'UDDH" }
  ]);

  if (!window.fetch) return;

  fetch("/api/articles")
    .then(function (response) {
      return response.ok ? response.json() : Promise.reject(new Error("Impossible de charger les actualités du bandeau"));
    })
    .then(function (payload) {
      if (!payload || !Array.isArray(payload.articles)) {
        throw new Error("La réponse des actualités est invalide");
      }

      var articles = payload.articles.filter(function (article) {
        return (article.status === "publié" || article.status === "published") && article.title && article.slug;
      });
      if (!articles.length) return;

      updateTicker(articles.map(function (article) {
        return {
          href: "article.html?slug=" + encodeURIComponent(article.slug),
          title: article.title
        };
      }));
    })
    .catch(function (error) {
      console.error("Erreur lors du chargement des actualités du bandeau :", error);
    });
}

/* Formulaire contact : validation locale (pas d'envoi serveur) */
function initContactForm() {
  var form = document.getElementById("contact-form");
  if (!form) return;

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var nom = form.querySelector("#nom");
    var email = form.querySelector("#email");
    var tel = form.querySelector("#telephone");
    var sujet = form.querySelector("#sujet");
    var message = form.querySelector("#message");
    var feedback = document.getElementById("form-feedback");
    var ok = true;

    form.querySelectorAll(".field-error").forEach(function (el) {
      el.textContent = "";
    });

    function showError(input, text) {
      var box = input.parentElement.querySelector(".field-error");
      if (box) box.textContent = text;
      ok = false;
    }

    if (!nom.value.trim()) {
      showError(nom, "Veuillez indiquer votre nom complet.");
    }
    if (!email.value.trim()) {
      showError(email, "Veuillez indiquer votre adresse email.");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
      showError(email, "Veuillez indiquer une adresse email valide.");
    }
    if (!tel.value.trim()) {
      showError(tel, "Veuillez indiquer votre numéro de téléphone.");
    }
    if (!sujet.value.trim()) {
      showError(sujet, "Veuillez indiquer le sujet.");
    }
    if (!message.value.trim()) {
      showError(message, "Veuillez rédiger votre message.");
    }

    if (!ok) return;

    feedback.hidden = false;
    feedback.textContent =
      "Merci pour votre message. Nous vous contacterons dans les meilleurs délais.";
    form.reset();
  });
}

/* Galerie : filtres + lightbox */
function initGallery() {
  var grid = document.getElementById("gallery-grid");
  var lightbox = document.getElementById("lightbox");
  if (!grid || !lightbox) return;

  var items = Array.prototype.slice.call(grid.querySelectorAll(".gallery-item"));
  var filters = document.querySelectorAll(".gallery-filters button");
  var lbImg = lightbox.querySelector(".lightbox-image");
  var lbCap = lightbox.querySelector(".lightbox-caption");
  var current = 0;

  function visibleItems() {
    return items.filter(function (item) {
      return !item.hidden;
    });
  }

  filters.forEach(function (btn) {
    btn.addEventListener("click", function () {
      filters.forEach(function (b) {
        b.classList.remove("is-active");
      });
      btn.classList.add("is-active");

      var cat = btn.getAttribute("data-filter");
      items.forEach(function (item) {
        var show = cat === "all" || item.getAttribute("data-category") === cat;
        item.hidden = !show;
      });
    });
  });

  function openAt(index) {
    var vis = visibleItems();
    if (!vis.length) return;
    current = (index + vis.length) % vis.length;
    var img = vis[current].querySelector("img");
    lbImg.src = img.src;
    lbImg.alt = img.alt;
    lbCap.textContent = img.alt;
    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
    document.body.classList.add("nav-lock");
  }

  function closeLightbox() {
    lightbox.classList.remove("is-open");
    lightbox.setAttribute("aria-hidden", "true");
    document.body.classList.remove("nav-lock");
  }

  items.forEach(function (item) {
    item.addEventListener("click", function () {
      openAt(visibleItems().indexOf(item));
    });
  });

  lightbox.querySelector(".lightbox-close").addEventListener("click", closeLightbox);
  lightbox.querySelector(".lightbox-prev").addEventListener("click", function () {
    openAt(current - 1);
  });
  lightbox.querySelector(".lightbox-next").addEventListener("click", function () {
    openAt(current + 1);
  });
  lightbox.addEventListener("click", function (e) {
    if (e.target === lightbox) closeLightbox();
  });

  document.addEventListener("keydown", function (e) {
    if (!lightbox.classList.contains("is-open")) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") openAt(current - 1);
    if (e.key === "ArrowRight") openAt(current + 1);
  });
}

document.addEventListener("DOMContentLoaded", function () {
  initWhatsAppLinks();
  initHeader();
  initHeaderScroll();
  initScrollReveal();
  initNewsMarquee();
  initNewsTicker();
  initContactForm();
  initGallery();
});
