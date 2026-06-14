import { Download, RotateCcw, Save } from "lucide-react";
import { useState } from "react";
import { completedCount } from "../../domain/today";
import type { CourseBundle, LearnerProfile, ProgressMap } from "../../domain/types";
import { pluralize } from "../../shared/utils/pluralize";
import { Button } from "../../ui/components/Button";
import { Kicker } from "../../ui/components/Kicker";
import { ProgressBar } from "../../ui/components/ProgressBar";
import styles from "./JournalView.module.css";

export function JournalView(props: JournalProps) {
  const [draft, setDraft] = useState<LearnerProfile>(props.profile || {});
  const takeaways = props.bundle.modules.filter((module) => props.progress[module.id]?.takeaway);
  return (
    <section className={styles.screen}>
      <h2 className={styles.title}>Профиль</h2>
      <ProfileProgress bundle={props.bundle} progress={props.progress} />
      <ProfileNotes takeaways={takeaways} progress={props.progress} />
      <ProfileForm draft={draft} setDraft={setDraft} saveProfile={props.saveProfile} />
      <DataActions exportData={props.exportData} resetProgress={props.resetProgress} />
    </section>
  );
}

interface JournalProps {
  bundle: CourseBundle;
  profile: LearnerProfile | null;
  progress: ProgressMap;
  saveProfile: (profile: LearnerProfile) => Promise<void>;
  resetProgress: () => Promise<void>;
  exportData: () => Promise<void>;
}

function ProfileProgress({ bundle, progress }: { bundle: CourseBundle; progress: ProgressMap }) {
  const completed = completedCount(bundle.modules, progress);
  const weakSpotCount = bundle.modules.reduce((count, module) => count + Object.keys(progress[module.id]?.weakSpots || {}).length, 0);
  return (
    <section className={styles.section} aria-label="Прогресс маршрута">
      <Kicker>Прогресс</Kicker>
      <div className={styles.summary}>
        <strong>{completed} из {bundle.modules.length} блоков завершено</strong>
        <ProgressBar value={completed} max={bundle.modules.length} label="Прогресс по блокам" />
      </div>
      <dl className={styles.stats}>
        <div><dt>Зачёты</dt><dd>{completed} сдано</dd></div>
        <div><dt>Слабые места</dt><dd>{weakSpotCount} {pluralize(weakSpotCount, "слабое место", "слабых места", "слабых мест")} в работе</dd></div>
      </dl>
    </section>
  );
}

function ProfileNotes({ takeaways, progress }: { takeaways: CourseBundle["modules"]; progress: ProgressMap }) {
  return (
    <section className={styles.section} aria-labelledby="takeaway-heading">
      <Kicker>Конспект</Kicker>
      <h3 id="takeaway-heading">Суть, которую вы сохранили по ходу маршрута</h3>
      {takeaways.length ? (
        <div className={styles.takeawayList}>
          {takeaways.map((module) => (
            <article key={module.id} className={styles.takeaway}>
              <strong>{module.id} · {module.title}</strong>
              <p>{progress[module.id]?.takeaway}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}><p>Конспект пока пуст.</p><p>Сохраняйте суть после блоков — она появится здесь.</p></div>
      )}
    </section>
  );
}

function ProfileForm({ draft, setDraft, saveProfile }: { draft: LearnerProfile; setDraft: (profile: LearnerProfile) => void; saveProfile: (profile: LearnerProfile) => Promise<void> }) {
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void saveProfile(draft);
  };
  return (
    <form className={[styles.section, styles.form].join(" ")} onSubmit={submit}>
      <Kicker>Настройки</Kicker>
      <label>Имя<input value={draft.name || ""} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>Цель<textarea value={draft.goal || ""} onChange={(event) => setDraft({ ...draft, goal: event.target.value })} /></label>
      <Button variant="secondary" type="submit"><Save size={18} />Сохранить профиль</Button>
    </form>
  );
}

function DataActions({ exportData, resetProgress }: { exportData: () => Promise<void>; resetProgress: () => Promise<void> }) {
  const confirmReset = () => {
    if (window.confirm("Сбросить прогресс? Это действие нельзя отменить.")) void resetProgress();
  };
  return (
    <section className={[styles.section, styles.dangerZone].join(" ")}>
      <Kicker>Данные</Kicker>
      <div className={styles.dataActions}>
        <Button variant="secondary" onClick={() => void exportData()}><Download size={18} />Экспорт данных</Button>
        <Button variant="secondary" onClick={confirmReset}><RotateCcw size={18} />Сбросить прогресс</Button>
      </div>
    </section>
  );
}
