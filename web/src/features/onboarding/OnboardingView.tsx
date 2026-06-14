import type { LearnerProfile } from "../../domain/types";
import { Button } from "../../ui/components/Button";
import { Kicker } from "../../ui/components/Kicker";
import { ProcessTiles } from "../../ui/components/ProcessTiles";
import { SafetyNote } from "../../ui/components/SafetyNote";
import { navigate } from "../../ui/route";
import styles from "./OnboardingView.module.css";

interface Props {
  saveProfile: (profile: LearnerProfile) => Promise<void>;
}

export function OnboardingView({ saveProfile }: Props) {
  const handleStart = async () => {
    await saveProfile({ startedAt: new Date().toISOString() });
    navigate({ screen: "courses" });
  };

  return (
    <div className={styles.screen}>
      <div className={styles.body}>
        <img src="/assets/course-mark.svg" alt="" className={styles.mark} aria-hidden="true" />
        <Kicker>Somnenie · Курсы</Kicker>
        <h1 className={styles.title}>Учиться без мифов</h1>
        <p className={styles.lead}>
          Пошаговые курсы с маршрутом, зачётами и тренажёром слабых мест.
          Выбирайте направление и двигайтесь в своём темпе.
        </p>
        <ProcessTiles />
        <ul className={styles.features}>
          <li><strong>Теория</strong> — проверенные источники и понятные объяснения</li>
          <li><strong>Практика</strong> — задания и разбор после каждого блока</li>
          <li><strong>Тренажёр</strong> — интервальные повторения для долгого запоминания</li>
        </ul>
        <Button variant="primary" size="large" className={styles.cta} onClick={() => void handleStart()}>
          Начать
        </Button>
        <SafetyNote>
          Курсы не заменяют профессиональные консультации и индивидуальные рекомендации.
        </SafetyNote>
      </div>
    </div>
  );
}
