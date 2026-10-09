import styles from "./Avatar.module.css";

// Signal-style default avatars: pastel background with darker initials.
const COLORS = [
  ["#e3e3fe", "#3838f5"],
  ["#dde7fc", "#1251d3"],
  ["#d8e8f0", "#086da0"],
  ["#cde4cd", "#067906"],
  ["#eae0f8", "#661aff"],
  ["#f5e3fe", "#9f00f0"],
  ["#f6d8ec", "#b8057c"],
  ["#f5d7d7", "#be0404"],
  ["#fef5d0", "#836b01"],
  ["#eae6d5", "#7d6f40"],
];

// Text color for a seed, e.g. to color a sender's name in a group like Signal does.
// CSS light-dark() picks the dark initials color in light mode and the pastel in dark mode
// (it follows the color-scheme set in globals.css), so the name stays readable in both.
export function avatarTextColor(colorSeed: number): string {
  const [pastel, dark] = COLORS[Math.abs(colorSeed) % COLORS.length];
  return `light-dark(${dark}, ${pastel})`;
}

type Props = {
  name: string;
  src?: string | null;
  colorSeed: number; // e.g. user or conversation id, so the color is stable
  size?: number;
};

export default function Avatar({ name, src, colorSeed, size = 36 }: Props) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- data URLs; next/image adds nothing here
    return <img className={styles.avatar} src={src} alt={name} width={size} height={size} />;
  }

  const [background, color] = COLORS[Math.abs(colorSeed) % COLORS.length];
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");

  return (
    <div
      className={styles.avatar}
      style={{ width: size, height: size, background, color, fontSize: size * 0.4 }}
      aria-label={name}
    >
      {initials}
    </div>
  );
}
