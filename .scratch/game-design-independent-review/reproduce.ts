import { hasOutOfCardNumber } from '../../src/domain/product-facts';
import { SEED_PRODUCT_CARD } from '../../src/domain/seed';
import { observationPairs } from '../../src/ui/observation-focus';
import type { ConversationResult } from '../../src/domain/types';

const result: ConversationResult = {
  conversationId: 'review-only', observationFocus: 'signals', mainGoal: '未知', outcome: '未知', endReason: '客户主动结束通话', strategyPath: [],
  turns: [{ number: 1, speaker: 'customer', text: '别再打电话了，我现在要挂了。' }, { number: 2, speaker: 'manager', text: '理解，您先忙。' }],
};
console.log(JSON.stringify({
  concernLocator: { customerText: result.turns[0].text, locatedPairs: observationPairs(result).length },
  amountRelation: { reply: '您存5万就拿150元。', outOfCardNumber: hasOutOfCardNumber('您存5万就拿150元。', SEED_PRODUCT_CARD, []) },
  repeatedUnverifiedNumber: { reply: '参考年化4%。', outOfCardNumber: hasOutOfCardNumber('参考年化4%。', SEED_PRODUCT_CARD, [{ number: 2, speaker: 'manager', text: '参考年化4%。' }]) },
}, null, 2));
