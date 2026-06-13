import type { QuizQuestion } from "./types";

const REVIEW_SOURCE_BLOCKS = ["theory", "terms", "practice", "diagrams", "summary"] as const;

interface MetadataMarker {
  index: number;
  key: string;
  value: string;
}

interface AutoBuildInput {
  number: number;
  type: string;
  text: string;
  answerRaw: string;
  explain: string;
  sourceBlock: string;
}

export function parseQuiz(markdown: string): QuizQuestion[] {
  const text = String(markdown || "");
  const matches = Array.from(text.matchAll(/^##\s*Q(\d+)\s*\(([^)]+)\)\s*$/gm));
  return matches.map((match, index) => parseQuestion(text, matches, match, index)).filter(Boolean) as QuizQuestion[];
}

export function parseAutoQuestion(number: number, type: string, body: string, sourceBlock = "theory"): QuizQuestion | null {
  const { markers, lines } = parseMetadata(body);
  const answerIndex = markers.findIndex((marker) => /ответ|answer|правильный/i.test(marker.key));
  const explanationIndex = markers.findIndex((marker, index) => index !== answerIndex && /объяснение|разбор|explain/i.test(marker.key));
  const beforeAnswer = visibleQuestionText(lines, markers, answerIndex >= 0 ? markers[answerIndex].index : lines.length);
  const answerRaw = answerIndex >= 0 ? parseAnswerText(markers, answerIndex, lines) : "";
  return buildAutoQuestion({ number, type, text: beforeAnswer, answerRaw, explain: explanationText(markers, explanationIndex, answerIndex, lines), sourceBlock });
}

export function parseApplicationQuestion(number: number, body: string, sourceBlock = "practice"): QuizQuestion {
  const { markers, lines } = parseMetadata(body);
  const answerIndex = markers.findIndex((marker) => !isSourceMetadata(marker));
  return {
    number,
    type: "Применение",
    kind: "application",
    text: visibleQuestionText(lines, markers, answerIndex >= 0 ? markers[answerIndex].index : lines.length),
    options: [],
    answer: null,
    explain: answerIndex >= 0 ? parseAnswerText(markers, answerIndex, lines) : "",
    sourceBlock: normalizeSourceBlock(sourceBlock, "practice"),
  };
}

function parseQuestion(text: string, matches: RegExpMatchArray[], match: RegExpMatchArray, index: number): QuizQuestion | null {
  const start = Number(match.index) + match[0].length;
  const end = index + 1 < matches.length ? Number(matches[index + 1].index) : text.length;
  const number = Number(match[1]);
  const type = String(match[2] || "").trim();
  const body = text.slice(start, end).trim();
  const sourceBlock = parseSourceBlock(body, type === "Применение" ? "practice" : "theory");
  return type === "Применение" ? parseApplicationQuestion(number, body, sourceBlock) : parseAutoQuestion(number, type, body, sourceBlock);
}

function buildAutoQuestion(input: AutoBuildInput): QuizQuestion | null {
  if (/mcq/i.test(input.type)) return buildMcqQuestion(input);
  if (/true|false|верно/i.test(input.type)) return buildTrueFalseQuestion(input);
  return null;
}

function buildMcqQuestion(input: AutoBuildInput): QuizQuestion | null {
  const options = Array.from(input.text.matchAll(/^([A-D])\.\s+(.+)$/gm)).map((option) => ({ key: option[1].toUpperCase(), text: option[2].trim() }));
  const answer = input.answerRaw.match(/([A-D])/i)?.[1]?.toUpperCase() || null;
  if (!answer || !options.some((option) => option.key === answer)) return null;
  return { number: input.number, type: input.type, kind: "auto", text: stripOptions(input.text), options, answer, explain: input.explain, sourceBlock: normalizeSourceBlock(input.sourceBlock, "theory") };
}

function buildTrueFalseQuestion(input: AutoBuildInput): QuizQuestion | null {
  const answer = /неверно|нет|ложь|false/i.test(input.answerRaw) ? false : /верно|да|истина|true/i.test(input.answerRaw) ? true : null;
  if (answer === null) return null;
  return { number: input.number, type: input.type, kind: "auto", text: input.text, options: [{ key: "true", text: "Верно" }, { key: "false", text: "Неверно" }], answer, explain: input.explain, sourceBlock: normalizeSourceBlock(input.sourceBlock, "theory") };
}

function parseMetadata(body: string): { markers: MetadataMarker[]; lines: string[] } {
  const lines = splitLines(body);
  const markers = lines.map((line, index) => ({ index, metadata: extractMetadataLine(line) }))
    .filter((item) => item.metadata)
    .map((item) => ({ index: item.index, ...item.metadata }) as MetadataMarker);
  return { markers, lines };
}

function extractMetadataLine(line: string): Omit<MetadataMarker, "index"> | null {
  const source = String(line || "").trim();
  const match = source.match(/^\*\*([^*:]+?)\s*:\s*([^*]*)\*\*$/)
    || source.match(/^\*\*([^*:]+?)\s*:\s*\*\*\s*(.*)$/)
    || source.match(/^(sourceblock|source_block|source block)\s*:?\s*([a-z._-]+)\s*$/i);
  return match ? { key: match[1].trim().toLowerCase(), value: match[2].trim() } : null;
}

function parseSourceBlock(body: string, fallback: string): string {
  const { markers, lines } = parseMetadata(body);
  const marker = markers.find(isSourceMetadata);
  const inline = lines.join("\n").match(/^\s*(?:sourceblock|source_block|source block)\s*:?\s*([a-z._-]+)/i);
  return marker?.value || inline?.[1] || fallback;
}

function visibleQuestionText(lines: string[], markers: MetadataMarker[], endLineIndex: number): string {
  const sourceIndexes = new Set(markers.filter(isSourceMetadata).map((marker) => marker.index));
  return lines.slice(0, endLineIndex).filter((_, index) => !sourceIndexes.has(index)).join("\n").trim();
}

function parseAnswerText(markers: MetadataMarker[], answerIndex: number, lines: string[]): string {
  const next = markers[answerIndex + 1];
  return lines.slice(markers[answerIndex].index, next ? next.index : lines.length).join("\n").replace(/^\*\*[^*:]+:\s*([^*]*)\*\*/m, "$1").trim();
}

function explanationText(markers: MetadataMarker[], explanationIndex: number, answerIndex: number, lines: string[]): string {
  if (explanationIndex >= 0) return parseAnswerText(markers, explanationIndex, lines);
  return answerIndex >= 0 ? lines.slice(markers[answerIndex].index + 1).join("\n").trim() : "";
}

function normalizeSourceBlock(value: string, fallback: string): string {
  const clean = String(value || "").trim().toLowerCase().replace(/\.md$/i, "");
  return REVIEW_SOURCE_BLOCKS.includes(clean as (typeof REVIEW_SOURCE_BLOCKS)[number]) ? clean : fallback;
}

function isSourceMetadata(marker: MetadataMarker): boolean {
  return marker.key === "sourceblock" || marker.key === "источник";
}

function stripOptions(text: string): string {
  return text.replace(/^([A-D])\.\s+.+$/gm, "").trim();
}

function splitLines(text: string): string[] {
  return String(text || "").replace(/\r\n/g, "\n").split("\n");
}
