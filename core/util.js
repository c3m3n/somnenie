(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  // Чистые UI-утилиты — единый источник истины для браузера (глобаль), node (require)
  // и vm-контекста смоук-тестов. Выставляем и пространство имён, и «голые» глобали,
  // чтобы существующие неуточнённые вызовы escapeHtml(...) продолжали работать.
  const expose = (target) => {
    if (!target) return;
    target.NutrioUtil = api;
    target.escapeHtml = api.escapeHtml;
    target.escapeHtmlAttribute = api.escapeHtmlAttribute;
    target.plainText = api.plainText;
  };
  expose(root);
  if (root && root.window && root.window !== root) expose(root.window);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function escapeHtmlAttribute(s) {
    return escapeHtml(s).replace(/`/g, "&#96;");
  }

  function plainText(s) {
    return String(s)
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/[*_>#\-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return { escapeHtml, escapeHtmlAttribute, plainText };
});
