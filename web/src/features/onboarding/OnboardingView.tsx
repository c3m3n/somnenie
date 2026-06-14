import type { LearnerProfile } from "../../domain/types";

interface Props {
  saveProfile: (profile: LearnerProfile) => Promise<void>;
}

export function OnboardingView({ saveProfile }: Props) {
  const handleStart = () => {
    void saveProfile({ startedAt: new Date().toISOString() });
  };

  return (
    <div className="onboarding-screen">
      <div className="onboarding-body">
        <span className="section-kicker">Somnenie · Курсы</span>
        <h1 className="onboarding-title">Учиться без мифов</h1>
        <p className="onboarding-lead">
          Пошаговые курсы с маршрутом, зачётами и тренажёром слабых мест.
          Выбирайте направление и двигайтесь в своём темпе.
        </p>
        <ul className="onboarding-features">
          <li><strong>Теория</strong> — проверенные источники и понятные объяснения</li>
          <li><strong>Практика</strong> — задания и разбор после каждого блока</li>
          <li><strong>Тренажёр</strong> — интервальные повторения для долгого запоминания</li>
        </ul>
        <button className="primary-action onboarding-cta" type="button" onClick={handleStart}>
          Начать
        </button>
        <p className="onboarding-disclaimer">
          Курсы не заменяют профессиональные консультации и индивидуальные рекомендации.
        </p>
      </div>
    </div>
  );
}
