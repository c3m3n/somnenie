import { Download, RotateCcw, Save } from "lucide-react";
import { useState } from "react";
import { completedCount } from "../../domain/today";
import type { CourseBundle, LearnerProfile, ProgressMap } from "../../domain/types";

export function JournalView(props: JournalProps) {
  const [draft, setDraft] = useState<LearnerProfile>(props.profile || {});
  const takeaways = props.bundle.modules.filter((module) => props.progress[module.id]?.takeaway);
  return <section className="screen journal-screen"><div className="section-kicker">Журнал</div><h2>Прогресс и выводы</h2><Summary bundle={props.bundle} progress={props.progress} /><ProfileForm draft={draft} setDraft={setDraft} saveProfile={props.saveProfile} /><div className="takeaway-list">{takeaways.map((module) => <article key={module.id}><strong>{module.id}</strong><p>{props.progress[module.id]?.takeaway}</p></article>)}</div><DataActions exportData={props.exportData} resetProgress={props.resetProgress} /></section>;
}

interface JournalProps {
  bundle: CourseBundle;
  profile: LearnerProfile | null;
  progress: ProgressMap;
  saveProfile: (profile: LearnerProfile) => Promise<void>;
  resetProgress: () => Promise<void>;
  exportData: () => Promise<void>;
}

function Summary({ bundle, progress }: { bundle: CourseBundle; progress: ProgressMap }) {
  const completed = completedCount(bundle.modules, progress);
  return <div className="summary-line"><strong>{completed}/{bundle.modules.length}</strong><span>станций завершено</span><progress value={completed} max={bundle.modules.length} /></div>;
}

function ProfileForm({ draft, setDraft, saveProfile }: { draft: LearnerProfile; setDraft: (profile: LearnerProfile) => void; saveProfile: (profile: LearnerProfile) => Promise<void> }) {
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void saveProfile(draft);
  };
  return <form className="profile-form" onSubmit={submit}><label>Имя<input value={draft.name || ""} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>Цель<textarea value={draft.goal || ""} onChange={(event) => setDraft({ ...draft, goal: event.target.value })} /></label><button type="submit"><Save size={18} />Сохранить профиль</button></form>;
}

function DataActions({ exportData, resetProgress }: { exportData: () => Promise<void>; resetProgress: () => Promise<void> }) {
  return <div className="data-actions"><button type="button" onClick={() => void exportData()}><Download size={18} />Экспорт данных</button><button type="button" onClick={() => void resetProgress()}><RotateCcw size={18} />Сбросить прогресс</button></div>;
}
