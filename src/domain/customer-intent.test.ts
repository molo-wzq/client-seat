import { describe, expect, it } from 'vitest';
import { customerIntent, consecutiveHesitations } from './customer-intent';

describe('当前客户意图', () => {
  it.each(['别再打电话了，我现在要挂了。', '不用了，谢谢', '我现在开会', '今天不方便', '不要再联系我', '先这样，拜拜', '好了好了,不用了,拜拜'])('明确离场：%s', (text) => expect(customerIntent(text)).toBe('leave'));
  it.each(['如果我说别打了会怎样？', '他说“别再打电话了”，我还有问题', '先别挂，我想了解条件', '不是要挂电话', '你为什么说不用了？', '我不想挂电话', '别打岔，我想了解条件', '挂断前我想问一个问题', '再见这个词是告别吗？'])('引述、否定和提问不替客户离场：%s', (text) => expect(customerIntent(text)).not.toBe('leave'));
  it('同一句重新开放与历史犹豫都服从当前意图', () => {
    expect(customerIntent('暂时不用，但我愿意再了解')).toBe('continue');
    expect(consecutiveHesitations([{ number: 1, speaker: 'customer', text: '考虑一下' }, { number: 3, speaker: 'customer', text: '我想了解条件' }], '再考虑一下')).toBe(1);
  });
});
