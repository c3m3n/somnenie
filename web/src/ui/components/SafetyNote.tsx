import styles from "./SafetyNote.module.css";

export function SafetyNote({ children }: { children: React.ReactNode }) {
  return <p className={styles.note}>{children}</p>;
}
