import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "small" | "default" | "large";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: styles.primary,
  secondary: styles.secondary,
  ghost: styles.ghost,
};

const sizeClass: Record<ButtonSize, string> = {
  small: styles.small,
  default: "",
  large: styles.large,
};

export function Button({ variant = "secondary", size = "default", className = "", children, ...rest }: ButtonProps) {
  const classes = [styles.button, variantClass[variant], sizeClass[size], className].filter(Boolean).join(" ");
  return (
    <button type="button" className={classes} {...rest}>
      {children}
    </button>
  );
}

interface ButtonLinkProps {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}

export function ButtonLink({ href, variant = "secondary", size = "default", className = "", children, onClick }: ButtonLinkProps) {
  const classes = [styles.button, variantClass[variant], sizeClass[size], className].filter(Boolean).join(" ");
  return (
    <a href={href} className={classes} onClick={onClick}>
      {children}
    </a>
  );
}
