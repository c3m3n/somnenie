import { ArrowRight, BookOpenCheck, CircleDot } from "lucide-react";
import type { ContentCatalog, CourseId, LearnerProfile, ProgressMap } from "../../domain/types";
import { completedCount } from "../../domain/today";
import { Button } from "../../ui/components/Button";
import { Kicker } from "../../ui/components/Kicker";
import styles from "./CourseCatalogView.module.css";

interface CourseCatalogViewProps {
  catalog: ContentCatalog | null;
  progress: ProgressMap;
  onSelectCourse: (courseId: CourseId) => void;
  saveProfile: (profile: LearnerProfile) => Promise<void>;
}

export function CourseCatalogView({ catalog, progress, onSelectCourse }: CourseCatalogViewProps) {
  if (!catalog?.courses.length) {
    return (
      <section className={styles.empty} role="status">
        <h2>Курсы не найдены</h2>
        <p>Не удалось загрузить каталог курсов.</p>
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

      <div className={styles.courseList}>
        {catalog.courses.map((course, index) => {
          const courseProgress = filterProgressByCourse(progress, course.id);
          const completed = Object.keys(courseProgress).length > 0 ? completedCount([], courseProgress) : 0;
          const started = completed > 0 || Object.keys(courseProgress).some((moduleId) => courseProgress[moduleId]?.theoryRead);
          return (
            <article key={course.id} className={styles.courseCard}>
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
              <Button variant={started ? "primary" : "secondary"} size="large" className={styles.courseButton} onClick={() => onSelectCourse(course.id)}>
                <span>{started ? "Продолжить" : "Начать"}</span>
                <ArrowRight size={20} aria-hidden="true" />
              </Button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function filterProgressByCourse(progress: ProgressMap, courseId: CourseId): ProgressMap {
  return Object.fromEntries(
    Object.entries(progress).filter(([moduleId]) => moduleId.startsWith(`${courseId}:`)),
  );
}
