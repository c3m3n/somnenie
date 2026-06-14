import type { ContentCatalog, CourseId, LearnerProfile, ProgressMap } from "../../domain/types";
import { completedCount } from "../../domain/today";

interface CourseCatalogViewProps {
  catalog: ContentCatalog | null;
  progress: ProgressMap;
  onSelectCourse: (courseId: CourseId) => void;
  saveProfile: (profile: LearnerProfile) => Promise<void>;
}

export function CourseCatalogView({ catalog, progress, onSelectCourse }: CourseCatalogViewProps) {
  if (!catalog?.courses.length) {
    return (
      <section className="screen" role="status">
        <h2>Курсы не найдены</h2>
        <p>Не удалось загрузить каталог курсов.</p>
      </section>
    );
  }

  return (
    <section className="screen today-screen">
      <h2>Выберите курс</h2>
      <div className="course-list">
        {catalog.courses.map((course) => {
          const courseProgress = filterProgressByCourse(progress, course.id);
          const completed = Object.keys(courseProgress).length > 0 ? completedCount([], courseProgress) : 0;
          const started = completed > 0 || Object.keys(courseProgress).some((moduleId) => courseProgress[moduleId]?.theoryRead);
          return (
            <article key={course.id} className="learning-dispatcher-card course-card">
              <div>
                <strong>{course.title}</strong>
                <p>{course.description}</p>
              </div>
              <button className="primary-action" type="button" onClick={() => onSelectCourse(course.id)}>
                {started ? "Продолжить" : "Начать"}
              </button>
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
