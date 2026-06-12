(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NutrioConst = api;
  if (root && root.window) root.window.NutrioConst = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Единственный источник истины для общих констант приложения.
  // Загружается раньше остальных скриптов; storage.js/review.js/app.js читают отсюда.
  return {
    COURSE_ID: "nutrition",
    SCHEMA_VERSION: 2,
    REVIEW_SCHEMA_VERSION: 2,
    QUIZ_PROGRESS_VERSION: 2,
    MODULE_FILES: ["theory.md", "terms.md", "quiz.md", "practice.md", "diagrams.md", "summary.md"],
  };
});
