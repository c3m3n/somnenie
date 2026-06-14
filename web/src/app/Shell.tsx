import { ArrowLeft, Brain, CircleUser, Gauge, Route as RouteIcon } from "lucide-react";
import type { CourseId } from "../domain/types";
import { routeHash, type Route, navigate } from "../ui/route";
import styles from "./Shell.module.css";

interface ShellProps {
  route: Route;
  children: React.ReactNode;
  updateAvailable: boolean;
  saveError?: string | null;
  onUpdate: () => void;
  mainRef?: React.RefObject<HTMLElement | null>;
  activeCourseId: CourseId | null;
}

export function Shell({ route, children, updateAvailable, saveError, onUpdate, mainRef, activeCourseId }: ShellProps) {
  const courseId = activeCourseId || "nutrition";
  return (
    <div className={styles.appShell} role="application" aria-label="Приложение обучения">
      <a className={styles.skipLink} href="#main-content">Перейти к содержимому</a>
      <header className={styles.topbar}>
        <a
          href={routeHash({ screen: "today", courseId })}
          className={styles.iconButton}
          aria-label="Назад"
          onClick={(event) => {
            event.preventDefault();
            goBack();
          }}
        >
          <ArrowLeft size={18} />
        </a>
        <div className={styles.brand}>
          <img src="/assets/generated/icon-today.png" alt="" />
          <div className={styles.brandText}>
            <span className={styles.brandName}>Somnenie</span>
            <strong className={styles.brandTitle}>{titleFor(route)}</strong>
          </div>
        </div>
        <div className={styles.actions}>
          <nav className={styles.desktopNav} aria-label="Основные разделы">
            <NavItem active={route.screen === "today"} href={routeHash({ screen: "today", courseId })} icon={<Gauge size={16} />} label="Сегодня" onClick={() => navigate({ screen: "today", courseId })} />
            <NavItem active={route.screen === "atlas"} href={routeHash({ screen: "atlas", courseId })} icon={<RouteIcon size={16} />} label="Маршрут" onClick={() => navigate({ screen: "atlas", courseId })} />
            <NavItem active={route.screen === "memory"} href={routeHash({ screen: "memory", courseId })} icon={<Brain size={16} />} label="Тренажёр" onClick={() => navigate({ screen: "memory", courseId })} />
          </nav>
          <a
            className={[styles.iconButton, route.screen === "journal" ? styles.iconButtonActive : ""].filter(Boolean).join(" ")}
            aria-current={route.screen === "journal" ? "page" : undefined}
            aria-label="Профиль"
            href={routeHash({ screen: "journal", courseId })}
            onClick={(event) => {
              event.preventDefault();
              navigate({ screen: "journal", courseId });
            }}
          >
            <CircleUser size={18} />
          </a>
        </div>
      </header>
      {updateAvailable ? (
        <section className={styles.updateBanner} role="status" aria-live="polite">
          <span>Доступно обновление приложения</span>
          <button type="button" onClick={onUpdate}>Обновить</button>
        </section>
      ) : null}
      {saveError ? (
        <section className={styles.saveErrorBanner} role="alert" aria-live="assertive">
          <span>Ошибка сохранения: {saveError}</span>
        </section>
      ) : null}
      <main id="main-content" className={styles.main} ref={mainRef} tabIndex={-1}>{children}</main>
    </div>
  );
}

function NavItem({ active, href, icon, label, onClick }: { active: boolean; href: string; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <a className={[styles.navItem, active ? styles.navItemActive : ""].filter(Boolean).join(" ")} aria-current={active ? "page" : undefined} href={href} onClick={(event) => {
      event.preventDefault();
      onClick();
    }}>
      {icon}{label}
    </a>
  );
}

function goBack(): void {
  if (window.history.length > 1) window.history.back();
  else navigate({ screen: "today", courseId: "nutrition" });
}

function titleFor(route: Route): string {
  if (route.screen === "atlas") return "Маршрут";
  if (route.screen === "memory") return "Тренажёр";
  if (route.screen === "journal") return "Профиль";
  if (route.screen === "remediation") return "Разбор ошибок";
  if (route.screen === "station") return route.moduleId;
  if (route.screen === "courses") return "Курсы";
  return "Сегодня";
}
