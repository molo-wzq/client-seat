import type { FeelingStamp } from "../domain/types";
import { FEELING_STAMPS, FEELING_STAMP_META } from "../domain/types";
import { playSfx, thump } from "./game-feel";

/**
 * 换位体感印章(票:直觉打标):玩家以客户身份听完一句经理话术,
 * 随手盖一枚直觉戳。只记录第一反应,不要求说理,不打断输入。
 */

/** 已盖的印章字面:轨道角标、复盘摘要、走势图共用同一张脸。 */
export function FeelingSeal({ feeling, label }: { feeling: FeelingStamp; label?: boolean }) {
  const meta = FEELING_STAMP_META[feeling];
  return (
    <i className={`feeling-seal tone-${meta.tone}`} data-feeling={feeling} title={`${meta.label}——${meta.desc}`}>
      <span aria-hidden="true">{meta.seal}</span>
      {label ? <span className="feeling-seal-label">{meta.label}</span> : <span className="visually-hidden">{meta.label}</span>}
    </i>
  );
}

export function FeelingStampBar({
  value,
  disabled,
  onPick,
}: {
  /** 这一经理轮当前已盖的戳;未盖为空。 */
  value: FeelingStamp | undefined;
  disabled?: boolean;
  onPick: (next: FeelingStamp | undefined) => void;
}) {
  return (
    <div className="feeling-stamps" role="group" aria-label="这句经理话术给你的感觉">
      {FEELING_STAMPS.map((key) => {
        const meta = FEELING_STAMP_META[key];
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            className={`feeling-stamp${active ? " active" : ""}`}
            data-feeling={key}
            disabled={disabled}
            aria-pressed={active}
            title={`${meta.label}——${meta.desc}`}
            // 免焦点盖戳:按下不夺走回复框的光标,正在打的字不受打扰。
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              if (active) {
                onPick(undefined);
                return;
              }
              playSfx("stamp");
              thump(e.currentTarget.closest(".turn"));
              onPick(key);
            }}
          >
            <span className="seal-face" aria-hidden="true">{meta.seal}</span>
            <span className="seal-label">{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}
