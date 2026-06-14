import styles from "./ProgressBar.module.css";

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  return <progress className={styles.progress} max={max} value={value} aria-label={label} />;
}
