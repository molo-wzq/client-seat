import type { VirtualProductCard } from "../domain/types";

/** 活动时间安排与产品取用分别列出,不补卡外限制或保证。 */
export function ProductFacts({ product }: { product: VirtualProductCard }) {
  const { activity, flexibleProduct } = product;
  return <>
    <strong>{activity.name}</strong>
    <p>活动面向：{activity.audience ?? "旧参数未单独记录，请核对活动名称与规则"}</p>
    <p>{activity.rule}</p>
    <ul aria-label="分档权益">
      {activity.tiers.map((tier) => <li key={tier.amount}><strong>{tier.amount}</strong><span>{tier.reward}</span></li>)}
    </ul>
    <p className="table-note-deadline">{activity.deadline}</p>
    <p className="hint">这是报名截止，不等于资金转入截止；未注明的资金达标日期和名额保持未知。</p>
    <strong>{flexibleProduct.name}</strong>
    <p>{flexibleProduct.type} · {flexibleProduct.liquidity}</p>
    <p>{flexibleProduct.referenceYield}</p>
    <p>面向：{flexibleProduct.audience}</p>
    <p className="hint">“无须立即转入”只说明报名时间安排；未列出的活动资金限制保持未知，不等于没有持有期或可随时取出。</p>
  </>;
}
