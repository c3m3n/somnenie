(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NutrioQuiz = api;
  if (root && root.window) root.window.NutrioQuiz = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const REVIEW_SOURCE_BLOCKS = ["theory", "terms", "practice", "diagrams"];

  function splitLines(text) {
    return String(text || "").replace(/\r\n?/g, "\n").split("\n");
  }

  function normalizeSourceBlock(value, fallback = "theory") {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) return fallback;
    const withoutExtension = normalized.replace(/\.md$/i, "");
    const direct = REVIEW_SOURCE_BLOCKS.includes(withoutExtension) ? withoutExtension : null;
    if (direct) return direct;
    if (withoutExtension === "term" || withoutExtension === "glossary") return "terms";
    return fallback;
  }

  function extractMetadataLine(line) {
    const source = String(line || "").trim();
    const match = source.match(/^\*\*([^*:]+?)\s*:\s*([^*]*)\*\*$/)
      || source.match(/^\*\*([^*:]+?)\s*:\s*\*\*\s*(.*)$/)
      || source.match(/^(sourceblock|source_block|source block)\s*:?\s*([a-z._-]+)\s*$/i);
    if (!match) return null;
    const key = String(match[1] || "").trim().toLowerCase();
    const value = String(match[2] || "").trim();
    return { key, value };
  }

  function isSourceMetadata(marker) {
    return marker?.key === "sourceblock" || marker?.key === "источник";
  }

  function parseMetadata(body) {
    const lines = splitLines(body);
    const markers = [];
    for (let i = 0; i < lines.length; i++) {
      const metadata = extractMetadataLine(lines[i]);
      if (!metadata) continue;
      markers.push(Object.assign({ index: i }, metadata));
    }
    return { lines, markers };
  }

  function stripVisibleSourcePrefix(text) {
    return String(text || "")
      .replace(/^\s*(?:sourceblock|source_block|source block)\s*:?\s*(?:theory|terms|practice|diagrams|term|glossary)(?:\.md)?\s*/i, "")
      .trim();
  }

  function visibleQuestionText(lines, markers, endLineIndex = lines.length) {
    const sourceLineIndexes = new Set(markers.filter(isSourceMetadata).map((marker) => marker.index));
    const text = lines
      .slice(0, endLineIndex)
      .filter((_, index) => !sourceLineIndexes.has(index))
      .join("\n")
      .trim();
    return stripVisibleSourcePrefix(text);
  }

  function parseSourceBlock(body, fallback = "theory") {
    const { markers, lines } = parseMetadata(body);
    const sourceMeta = markers.find(isSourceMetadata);
    if (sourceMeta) return normalizeSourceBlock(sourceMeta.value, fallback);
    const inlineSource = lines.join("\n").match(/^\s*(?:sourceblock|source_block|source block)\s*:?\s*([a-z._-]+)/i);
    return inlineSource ? normalizeSourceBlock(inlineSource[1], fallback) : fallback;
  }

  function parseAnswerText(markers, answerIndex, lines) {
    if (answerIndex < 0) return "";
    const nextMarker = markers[answerIndex + 1];
    const end = nextMarker ? nextMarker.index : lines.length;
    const pieces = [];
    const current = markers[answerIndex];
    if (current.value) pieces.push(current.value);
    for (let i = current.index + 1; i < end; i++) {
      if (lines[i] && lines[i].trim()) pieces.push(lines[i].trim());
    }
    return pieces.join(" ").trim();
  }

  function parseQuiz(md) {
    if (!md) return [];

    const text = String(md);
    const matches = Array.from(text.matchAll(/^##\s*Q(\d+)\s*\(([^)]+)\)\s*$/gm));
    if (!matches.length) return [];

    const questions = [];
    for (let index = 0; index < matches.length; index++) {
      const match = matches[index];
      const start = match.index + match[0].length;
      const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
      const number = Number(match[1]);
      const rawType = String(match[2] || "").trim();
      const body = text.slice(start, end).trim();
      const sourceBlock = parseSourceBlock(body, null);

      if (/^MCQ$/i.test(rawType) || /^True\/False$/i.test(rawType)) {
        const q = parseAutoQuestion(number, rawType, body, sourceBlock);
        if (q) questions.push(q);
      } else {
        const q = parseApplicationQuestion(number, body, sourceBlock);
        if (q) questions.push(q);
      }
    }

    return questions;
  }

  function parseAutoQuestion(number, type, body, sourceBlock = "theory") {
    const data = parseMetadata(body);
    const metadata = data.markers;
    const lines = data.lines;
    const answerIndex = metadata.findIndex((marker, markerIndex) => {
      if (isSourceMetadata(marker)) return false;
      return marker.key.includes("ответ") || marker.key.includes("answer") || marker.key.includes("правильный");
    });
    const explanationIndex = metadata.findIndex((marker, markerIndex) => {
      if (markerIndex === answerIndex) return false;
      if (isSourceMetadata(marker)) return false;
      return marker.key.includes("объясн") || marker.key.includes("explain") || marker.key.includes("разбор");
    });

    const answerLineIndex = answerIndex >= 0 ? metadata[answerIndex].index : lines.length;
    const beforeAnswer = visibleQuestionText(lines, metadata, answerLineIndex);
    const answerRaw = answerIndex >= 0 ? parseAnswerText(metadata, answerIndex, lines) : "";

    if (!beforeAnswer) return null;

    let options = [];
    let text = beforeAnswer;
    let answer = null;
    const normalizedType = String(type || "").toLowerCase();

    if (normalizedType === "mcq") {
      const optionMatches = Array.from(beforeAnswer.matchAll(/^([A-D])\.\s+(.+)$/gm));
      options = optionMatches.map((m) => ({ key: m[1], text: m[2].trim() }));
      text = beforeAnswer.replace(/^([A-D])\.\s+.+$/gm, "").trim();
      const letter = answerRaw.match(/([A-D])/i);
      answer = letter ? letter[1].toUpperCase() : null;
      if (!options.some((opt) => opt.key === answer)) return null;
    } else {
      options = [{ key: true, text: "Да" }, { key: false, text: "Нет" }];
      if (/неверно|нет|ложь|false/i.test(answerRaw)) answer = false;
      else if (/верно|да|истина|true/i.test(answerRaw)) answer = true;
      if (answer === null) return null;
    }

    const explainMarker = explanationIndex >= 0 ? metadata[explanationIndex] : null;
    const explainLines = [];
    if (explainMarker) {
      if (explainMarker.value) explainLines.push(explainMarker.value);
      const nextMarkerIndex = metadata[explanationIndex + 1]?.index || lines.length;
      for (let i = explainMarker.index + 1; i < nextMarkerIndex; i++) {
        if (lines[i] && lines[i].trim()) explainLines.push(lines[i].trim());
      }
    }
    if (!explainLines.length && answerIndex >= 0) {
      for (let i = (metadata[answerIndex]?.index || lines.length) + 1; i < lines.length; i++) {
        if (lines[i] && lines[i].trim()) explainLines.push(lines[i].trim());
      }
    }

    return {
      kind: "auto",
      number,
      type,
      text,
      options,
      answer,
      explain: explainLines.join(" ").trim(),
      sourceBlock: normalizeSourceBlock(sourceBlock, "theory"),
    };
  }

  function parseApplicationQuestion(number, body, sourceBlock = "practice") {
    const data = parseMetadata(body);
    const metadata = data.markers;
    const lines = data.lines;
    const answerIndex = metadata.findIndex((marker) => !isSourceMetadata(marker));
    const answerLineIndex = answerIndex >= 0 ? metadata[answerIndex].index : lines.length;
    const text = visibleQuestionText(lines, metadata, answerLineIndex);
    const explain = answerIndex >= 0 ? parseAnswerText(metadata, answerIndex, lines) : "";

    if (!text) return null;

    return {
      kind: "application",
      number,
      type: "Применение",
      text,
      explain,
      sourceBlock: normalizeSourceBlock(sourceBlock, "practice"),
    };
  }

  return {
    parseQuiz,
    parseAutoQuestion,
    parseApplicationQuestion,
  };
});
