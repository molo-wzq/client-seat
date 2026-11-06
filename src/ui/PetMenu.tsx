import type { AgentPolicy } from "../shared/agent-contract";
import type { PetVariant } from "./DeskPet";

/**
 * ⋯ 菜单(工单 15):头像下常驻按钮全删,切换男女、勿扰、放权「观察」档都收进这里;
 * 面板右上角「⋯」与右键头像都能打开。两档开关(只听我的/主动办)在状态条,不来这里。
 */
export function PetMenu({
  variant,
  policy,
  onSwitchVariant,
  onDnd,
  onSetMode,
}: {
  variant: PetVariant;
  policy: AgentPolicy | null;
  onSwitchVariant: () => void;
  onDnd: () => void;
  /** observe 档出口(演示第⑦幕仍用它)。 */
  onSetMode: (mode: "observe") => void;
}) {
  return (
    <div className="desk-pet-menu" role="menu" aria-label="桌宠设置">
      <button type="button" role="menuitem" onClick={onSwitchVariant}>
        切换{variant === "f" ? "男版" : "女版"}
      </button>
      <button type="button" role="menuitem" onClick={onDnd}>
        勿扰
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={policy?.acceptMode === "observe" ? "true" : "false"}
        onClick={() => onSetMode("observe")}
      >
        观察模式(只记录不办)
      </button>
    </div>
  );
}
