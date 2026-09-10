import p01Avatar from "../assets/avatars/p01-daifagua.png";
import p02Avatar from "../assets/avatars/p02-daoqi-wenjian.png";
import p03Avatar from "../assets/avatars/p03-dingqi-huashao.png";

const PERSONA_AVATARS: Record<string, string> = {
  "p01-daifagua": p01Avatar,
  "p02-daoqi-wenjian": p02Avatar,
  "p03-dingqi-huashao": p03Avatar,
};

export function PersonaAvatar({ personaId, name }: { personaId?: string; name: string }) {
  const src = personaId ? PERSONA_AVATARS[personaId] : undefined;

  return (
    <span className={`persona-avatar${src ? " has-image" : ""}`} aria-hidden="true">
      {src ? <img src={src} alt="" /> : name.slice(-1)}
    </span>
  );
}
