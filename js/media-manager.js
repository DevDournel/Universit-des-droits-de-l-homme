(function () {
  "use strict";

  var storageKey = "uddh-media-overrides";

  function normalize(source) {
    return source.split("?")[0].replace(/^\.\.\//, "").replace(/^\.\//, "");
  }

  function getOverrides() {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "{}");
    } catch (error) {
      return {};
    }
  }

  function setOverride(source, value) {
    var overrides = getOverrides();
    overrides[normalize(source)] = value;
    localStorage.setItem(storageKey, JSON.stringify(overrides));
  }

  function resolve(source) {
    return getOverrides()[normalize(source)] || source;
  }

  function applyOverrides() {
    var overrides = getOverrides();
    document.querySelectorAll("img").forEach(function (image) {
      var source = image.dataset.mediaSource || image.getAttribute("src");
      if (!source || source.indexOf("data:") === 0) return;
      image.dataset.mediaSource = source;
      if (overrides[normalize(source)]) image.setAttribute("src", overrides[normalize(source)]);
    });

    document.querySelectorAll("[style*='background-image']").forEach(function (element) {
      var style = element.getAttribute("style");
      var match = style && style.match(/url\(['"]?([^'")]+)['"]?\)/);
      if (!match) return;
      var source = element.dataset.mediaSource || match[1];
      element.dataset.mediaSource = source;
      if (overrides[normalize(source)]) element.style.backgroundImage = "url(\"" + overrides[normalize(source)] + "\")";
    });
  }

  function applyServerMedia() {
    fetch("/api/media")
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (payload) {
        if (!payload) return;
        payload.media.forEach(function (media) {
          setOverride(media.media_key, media.file_url);
        });
        applyOverrides();
      })
      .catch(function () { /* Le site reste utilisable avec les chemins locaux. */ });
  }

  window.uddhMedia = { normalize: normalize, resolve: resolve, setOverride: setOverride, apply: applyOverrides, sync: applyServerMedia };
  document.addEventListener("DOMContentLoaded", function () {
    applyOverrides();
    applyServerMedia();
  });
}());