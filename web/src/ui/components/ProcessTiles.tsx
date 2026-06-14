import styles from "./ProcessTiles.module.css";

export interface ProcessTile {
  number: string;
  label: string;
}

const TILES: ProcessTile[] = [
  { number: "01", label: "Идея" },
  { number: "02", label: "Действие" },
  { number: "03", label: "Проверка" },
  { number: "04", label: "Вывод" },
];

export function ProcessTiles({ activeIndex, tiles = TILES }: { activeIndex?: number; tiles?: ProcessTile[] }) {
  return (
    <ol className={styles.list} aria-label="Этапы сессии">
      {tiles.map((tile, index) => (
        <li key={tile.number} className={[styles.tile, index === activeIndex ? styles.active : ""].filter(Boolean).join(" ")} aria-current={index === activeIndex ? "step" : undefined}>
          <span className={styles.number}>{tile.number}</span>
          <span className={styles.label}>{tile.label}</span>
        </li>
      ))}
    </ol>
  );
}
