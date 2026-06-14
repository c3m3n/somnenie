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
        <span className="section-kicker">Somnenie · Курс нутрициологии</span>
        <h1 className="onboarding-title">Питание без&nbsp;мифов</h1>
        <p className="onboarding-lead">
          24 блока доказательной нутрициологии — от нутриентов до долгосрочных привычек.
          Без детоксов, магических диет и маркетинга.
        </p>
        <ul className="onboarding-features">
          <li><strong>Теория</strong> — только то, что подтверждено исследованиями</li>
          <li><strong>Практика</strong> — задания после каждого блока</li>
          <li><strong>Тренажёр</strong> — интервальные повторения для долгого запоминания</li>
        </ul>
        <button className="primary-action onboarding-cta" type="button" onClick={handleStart}>
          Начать курс
        </button>
        <p className="onboarding-disclaimer">
          Курс не заменяет врача, диагностику и индивидуальные рекомендации.
        </p>
      </div>
    </div>
  );
}
