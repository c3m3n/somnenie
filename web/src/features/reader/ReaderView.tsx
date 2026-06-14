import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, NotebookPen } from "lucide-react";
import { ensureModuleFiles, moduleFilesLoaded } from "../../content/api";
import type { AppState, CourseBundle, CourseModule, ModuleProgress } from "../../domain/types";
import { navigate } from "../../ui/route";
import { Md } from "../../ui/md";

const READER_FILES = ["theory.md", "terms.md", "practice.md", "diagrams.md", "summary.md"] as const;

const PAGE_META: { file: (typeof READER_FILES)[number]; label: string }[] = [
  { file: "theory.md", label: "Теория" },
  { file: "terms.md", label: "Термины" },
  { file: "practice.md", label: "Применение" },
  { file: "diagrams.md", label: "Схемы" },
  { file: "summary.md", label: "Суть" },
];

interface ReaderProps {
  bundle: CourseBundle;
  module: CourseModule;
  progress: ModuleProgress;
  appState: AppState;
  saveProgress: (moduleId: string, patch: ModuleProgress) => Promise<void>;
  saveState: (patch: Partial<AppState>) => Promise<void>;
}

export function ReaderView({ bundle, module, progress, saveProgress }: ReaderProps) {
  const [ready, setReady] = useState(() => moduleFilesLoaded(module, [...READER_FILES]));
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState(progress.takeawayDraft ?? progress.takeaway ?? "");
  const saveTimer = useRef<number | null>(null);
  const rawIndex = progress.readerPageIndex ?? 0;
  const pageIndex = Math.min(Math.max(0, rawIndex), PAGE_META.length - 1);
  const isLastPage = pageIndex >= PAGE_META.length - 1;
  const page = PAGE_META[pageIndex];

  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
  }, []);

  const loadFiles = useCallback(() => {
    if (moduleFilesLoaded(module, [...READER_FILES])) {
      setReady(true);
      setError(false);
      return () => undefined;
    }
    let cancelled = false;
    setReady(false);
    setError(false);
    void ensureModuleFiles(bundle, module.id, [...READER_FILES])
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [bundle, module]);

  useEffect(() => {
    return loadFiles();
  }, [loadFiles]);

  if (error) {
    return (
      <section className="screen station-screen">
        <div className="load-error" role="alert">
          <p>Не удалось загрузить материал.</p>
          <p>Проверьте соединение и попробуйте снова.</p>
          <button className="primary-action" type="button" onClick={() => loadFiles()}>Повторить</button>
        </div>
      </section>
    );
  }

  if (!ready) {
    return (
      <section className="screen station-screen">
        <div className="loading" role="status">Загрузка материала...</div>
      </section>
    );
  }

  const saveDraft = (value: string) => {
    setDraft(value);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveProgress(module.id, { takeawayDraft: value });
    }, 350);
  };

  const goBack = () => {
    if (pageIndex > 0) void saveProgress(module.id, { readerPageIndex: pageIndex - 1 });
  };

  const goForward = async () => {
    if (isLastPage) {
      const patch: ModuleProgress = { theoryRead: true };
      const trimmed = draft.trim();
      if (trimmed) {
        patch.takeaway = trimmed;
        patch.takeawayDraft = "";
        patch.takeawayUpdatedAt = new Date().toISOString();
      }
      await saveProgress(module.id, patch);
      navigate({ screen: "station", moduleId: module.id, step: "check" });
    } else {
      await saveProgress(module.id, { readerPageIndex: pageIndex + 1 });
    }
  };

  return (
    <section className="screen station-screen reader-screen">
      <header className="station-head">
        <div className="section-kicker">Блок · {module.phaseTitle}</div>
        <h2>{module.id}. {module.title}</h2>
        <p>{page.label} · {pageIndex + 1} / {PAGE_META.length}</p>
        <progress className="reader-progress" max={PAGE_META.length} value={pageIndex + 1} aria-label={`Страница ${pageIndex + 1} из ${PAGE_META.length}`} />
      </header>
      <Md as="article" className="markdown-block primary-sheet">{module.files[page.file]}</Md>
      {isLastPage ? (
        <div className="takeaway-editor">
          <label className="journal-editor">
            <span><NotebookPen size={16} /> Конспект блока (необязательно):</span>
            <textarea placeholder="Запишите главную мысль блока..." value={draft} onChange={(event) => saveDraft(event.target.value)} />
          </label>
        </div>
      ) : null}
      <nav className="reader-nav" aria-label="Навигация по страницам">
        {pageIndex > 0 ? (
          <button type="button" className="reader-back" onClick={goBack}>
            <ArrowLeft size={18} />Назад
          </button>
        ) : <span />}
        <button type="button" className="reader-forward primary-action" onClick={() => void goForward()}>
          {isLastPage ? <>К зачёту<ArrowRight size={18} /></> : <>Дальше<ArrowRight size={18} /></>}
        </button>
      </nav>
    </section>
  );
}
