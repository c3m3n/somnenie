import type { ReactNode } from "react";
import styles from "./Card.module.css";

interface CardProps {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  flat?: boolean;
  role?: string;
}

export function Card({ children, className = "", padded = true, flat = false, role }: CardProps) {
  const classes = [styles.card, padded ? styles.padded : "", flat ? styles.flat : "", className].filter(Boolean).join(" ");
  return <article className={classes} role={role}>{children}</article>;
}
