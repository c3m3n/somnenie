import { ArrowRight, BookOpenCheck, CircleDot, RotateCcw } from "lucide-react";
import type { ContentCatalog, CourseId, ProgressMap } from "../../domain/types";
import { completedCount } from "../../domain/today";
import { Button } from "../../ui/components/Button";
import { Kicker } from "../../ui/components/Kicker";
import styles from "./CourseCatalogView.module.css";

interface CourseCatalogViewProps {
  catalog: ContentCatalog | null;
  progress: ProgressMap;
  error: string | null;
  bundleError: string | null;
  loading: boolean;
  onSelectCourse: (courseId: CourseId) => void;
  onRetry: () => void;
}

export function CourseCatalogView({ catalog, progress, error, bundleError, loading, onSelectCourse, onRetry }: CourseCatalogViewProps) {
  if (loading && !catalog?.courses.length && !error) {
    return (
      <section className={styles.empty} role="status">
        <h2>Загрузка приложения…</h2>
      </section>
    );
  }

  if (error || !catalog?.courses.length) {
    return (
      <section className={styles.empty} role="status" aria-live="polite">
        <Kicker>Ошибка загрузки</Kicker>
        <h2>Не удалось загрузить каталог</h2>
        <p>Проверьте соединение и попробуйте снова. Если проблема останется — обновите страницу.</p>
        <Button variant="primary" size="large" onClick={onRetry} disabled={loading}>
          <RotateCcw size={18} aria-hidden="true" />
          {loading ? "Загрузка…" : "Повторить"}
        </Button>
        {error ? <pre className={styles.errorDetail}>{error}</pre> : null}
      </section>
    );
  }

  return (
    <section className={styles.screen}>
      <div className={styles.hero}>
        <div className={styles.heroCopy}>
          <Kicker>Маршруты Somnenie</Kicker>
          <h2 className={styles.title}>Выберите курс</h2>
          <p className={styles.lead}>
            Один маршрут за раз: короткие учебные сессии, зачёты и тренировка слабых мест без лишней платформенности.
          </p>
        </div>
        <div className={styles.heroVisual} aria-hidden="true">
          <span className={styles.visualLabel}>study map</span>
          <img src="/assets/course-mark.svg" alt="" className={styles.mark} />
          <span className={[styles.dot, styles.dotOne].join(" ")} />
          <span className={[styles.dot, styles.dotTwo].join(" ")} />
          <span className={[styles.dot, styles.dotThree].join(" ")} />
          <span className={[styles.dot, styles.dotFour].join(" ")} />
        </div>
      </div>

      <BundleErrorBanner bundleError={bundleError} loading={loading} onRetry={onRetry} />

      <div className={styles.courseList}>
        {catalog.courses.map((course, index) => (
          <CourseCard
            key={course.id}
            course={course}
            index={index}
            progress={progress}
            onSelect={onSelectCourse}
          />
        ))}
      </div>
    </section>
  );
}

function BundleErrorBanner({ bundleError, loading, onRetry }: { bundleError: string | null; loading: boolean; onRetry: () => void }) {
  if (!bundleError) return null;
  return (
    <div className={styles.bundleError} role="alert" aria-live="polite">
      <strong>Не удалось загрузить курс</strong>
      <span>{bundleError}</span>
      <Button variant="secondary" size="small" onClick={onRetry} disabled={loading}>
        <RotateCcw size={14} aria-hidden="true" />
        {loading ? "Загрузка…" : "Повторить"}
      </Button>
    </div>
  );
}

function CourseCard({ course, index, progress, onSelect }: { course: ContentCatalog["courses"][number]; index: number; progress: ProgressMap; onSelect: (courseId: CourseId) => void }) {
  const courseProgress = filterProgressByCourse(progress, course.id);
  const completed = Object.keys(courseProgress).length > 0 ? completedCount([], courseProgress) : 0;
  const started = completed > 0 || Object.keys(courseProgress).some((moduleId) => courseProgress[moduleId]?.theoryRead);
  return (
    <article className={styles.courseCard}>
      <div className={styles.cardHeader}>
        <span className={styles.courseIndex}>{String(index + 1).padStart(2, "0")}</span>
        <BookOpenCheck size={24} aria-hidden="true" />
      </div>
      <div className={styles.cardBody}>
        <strong className={styles.courseTitle}>{course.title}</strong>
        <p className={styles.courseDescription}>{course.description || "Собранный маршрут с материалами, зачётами и повторением."}</p>
      </div>
      <div className={styles.cardMeta}>
        <span><CircleDot size={14} aria-hidden="true" />{started ? "Есть прогресс" : "Новый маршрут"}</span>
      </div>
      <Button variant={started ? "primary" : "secondary"} size="large" className={styles.courseButton} onClick={() => onSelect(course.id)}>
        <span>{started ? "Продолжить" : "Начать"}</span>
        <ArrowRight size={20} aria-hidden="true" />
      </Button>
    </article>
  );
}

function filterProgressByCourse(progress: ProgressMap, courseId: CourseId): ProgressMap {
  return Object.fromEntries(
    Object.entries(progress).filter(([moduleId]) => moduleId.startsWith(`${courseId}:`)),
  );
}
