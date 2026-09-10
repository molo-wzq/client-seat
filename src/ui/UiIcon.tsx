import type { ReactNode, SVGProps } from "react";

export type UiIconName = "phone" | "play" | "table" | "material" | "cards" | "history" | "lock";

const paths: Record<UiIconName, ReactNode> = {
  phone: <path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.24c1.1.36 2.28.56 3.5.56a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.56 21 3 13.44 3 4a1 1 0 0 1 1-1h3.48a1 1 0 0 1 1 1c0 1.22.2 2.4.56 3.5a1 1 0 0 1-.24 1Z" />,
  play: <path d="m9 7 8 5-8 5Zm-5 5h2m12 0h2" />,
  table: <path d="M4 5h16v12H4zM8 17v3m8-3v3M8 9h8m-8 4h5" />,
  material: <path d="M6 3h9l3 3v15H6zM15 3v4h4M9 11h6m-6 4h6" />,
  cards: <path d="m8 4 10 2-3 15-10-2zM9 8l5 1m-6 4 5 1M5 6H3v11" />,
  history: <path d="M4 12a8 8 0 1 0 2.34-5.66L4 8.7M4 4v4.7h4.7M12 8v4l3 2" />,
  lock: <path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3" />,
};

export function UiIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: UiIconName }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...props}>
      {paths[name]}
    </svg>
  );
}
