import styles from "./Kicker.module.css";

export function Kicker({ children, muted = false, className = "" }: { children: React.ReactNode; muted?: boolean; className?: string }) {
  return <span className={[styles.kicker, muted ? styles.muted : "", className].filter(Boolean).join(" ")}>{children}</span>;
}
