import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, NotebookPen } from "lucide-react";
import { ensureModuleFiles, moduleFilesLoaded, readerFilesFromManifest } from "../../content/api";
import type { AppState, CourseBundle, CourseModule, ModuleProgress } from "../../domain/types";
import { navigate } from "../../ui/route";
import { Md } from "../../ui/md";
import { Kicker } from "../../ui/components/Kicker";
import { Button } from "../../ui/components/Button";
import { ProcessTiles } from "../../ui/components/ProcessTiles";
import styles from "./ReaderView.module.css";

const PAGE_LABELS: Record<string, string> = {
  "theory.md": "Теория",
  "terms.md": "Термины",
  "practice.md": "Применение",
  "diagrams.md": "Схемы",
  "summary.md": "Суть",
  "reading.md": "Чтение",
  "video-notes.md": "Конспект видео",
  "lab.md": "Лабораторная",
};

interface ReaderProps {
  bundle: CourseBundle;
  module: CourseModule;
  progress: ModuleProgress;
  appState: AppState;
  saveProgress: (moduleId: string, patch: ModuleProgress) => Promise<void>;
  saveState: (patch: Partial<AppState>) => Promise<void>;
}

export function ReaderView({ bundle, module, progress, saveProgress }: ReaderProps) {
  const readerFiles = useMemo(() => readerFilesFromManifest(bundle.manifest), [bundle.manifest]);
  const pageMeta = useMemo(() => readerFiles.map((file) => ({ file, label: PAGE_LABELS[file] || file })), [readerFiles]);
  const [ready, setReady] = useState(() => moduleFilesLoaded(module, readerFiles));
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState(progress.takeawayDraft ?? progress.takeaway ?? "");
  const saveTimer = useRef<number | null>(null);
  const rawIndex = progress.readerPageIndex ?? 0;
  const pageIndex = Math.min(Math.max(0, rawIndex), pageMeta.length - 1);
  const isLastPage = pageIndex >= pageMeta.length - 1;
  const page = pageMeta[pageIndex];

  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
  }, []);

  const loadFiles = useCallback(() => {
    if (moduleFilesLoaded(module, readerFiles)) {
      setReady(true);
      setError(false);
      return () => undefined;
    }
    let cancelled = false;
    setReady(false);
    setError(false);
    void ensureModuleFiles(bundle, module.id, readerFiles)
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [bundle, module, readerFiles]);

  useEffect(() => {
    return loadFiles();
  }, [loadFiles]);

  if (!page) {
    return (
      <section className={styles.screen}>
        <div className={styles.loadError} role="alert">
          <p>Не удалось определить файлы для чтения.</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className={styles.screen}>
        <div className={styles.loadError} role="alert">
          <p>Не удалось загрузить материал.</p>
          <p>Проверьте соединение и попробуйте снова.</p>
          <Button variant="primary" onClick={() => loadFiles()}>Повторить</Button>
        </div>
      </section>
    );
  }

  if (!ready) {
    return (
      <section className={styles.screen}>
        <div className={styles.loading} role="status">Загрузка материала...</div>
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
      navigate({ screen: "station", courseId: bundle.courseId, moduleId: module.id, step: "check" });
    } else {
      await saveProgress(module.id, { readerPageIndex: pageIndex + 1 });
    }
  };

  return (
    <section className={styles.screen}>
      <header className={styles.head}>
        <Kicker>Блок · {module.phaseTitle}</Kicker>
        <h2>{module.id}. {module.title}</h2>
        <p className={styles.headSubtitle}>{page.label} · {pageIndex + 1} / {pageMeta.length}</p>
        <ProcessTiles activeIndex={0} />
        <progress className={styles.readerProgress} max={pageMeta.length} value={pageIndex + 1} aria-label={`Страница ${pageIndex + 1} из ${pageMeta.length}`} />
      </header>
      <Md as="article" className="markdown-block primary-sheet">{module.files[page.file]}</Md>
      {isLastPage ? (
        <div className={styles.takeawayEditor}>
          <label className={styles.editor}>
            <span><NotebookPen size={16} /> Конспект блока (необязательно):</span>
            <textarea placeholder="Запишите главную мысль блока..." value={draft} onChange={(event) => saveDraft(event.target.value)} />
          </label>
        </div>
      ) : null}
      <nav className={styles.nav} aria-label="Навигация по страницам">
        {pageIndex > 0 ? (
          <Button variant="secondary" onClick={goBack}>
            <ArrowLeft size={18} />Назад
          </Button>
        ) : <span />}
        <Button variant="primary" onClick={() => void goForward()}>
          {isLastPage ? <>К зачёту<ArrowRight size={18} /></> : <>Дальше<ArrowRight size={18} /></>}
        </Button>
      </nav>
    </section>
  );
}
