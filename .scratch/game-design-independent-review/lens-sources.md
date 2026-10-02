# Schell 镜头：一手来源核验

核验日期：2026-10-02。仅调查作者、工作室、出版社资料；未阅读本项目说明、设计、路线图或代码。下列提问是中文压缩转述，供独立评审使用，不是书中逐字引文。

## 来源与版本

- [Schell Games 官方书籍入口](https://schellgames.com/art-of-game-design)直接链接[官方 Deck 网页应用](https://deck.artofgamedesign.com/)。镜头是从不同角度检查玩家体验的提问工具，不宜当成量化评分标准。
- 应用需要 JavaScript；已核对它公开加载的[当前应用数据](https://deck.artofgamedesign.com/js/app.95e37080.js)中的 `resources.LensList`、`cardTitle`、`questionlist`。应用自称 Tenth Anniversary Edition。本记录只用名称，不将应用编号外推为某一版书籍的编号。
- [Elsevier 第一版出版页](https://shop.elsevier.com/books/the-art-of-game-design/schell/978-0-12-369496-6)介绍 100 组镜头；[Schell Games 第三版有声书公告](https://schellgames.com/blog/art-of-game-design-audiobook-july-28)提到 116 张卡片。可确认版本集合有差异，不能用未指定版本的序号引用。

## 适合评审的镜头问题

以下镜头名称及提问主题均由[官方 Deck](https://deck.artofgamedesign.com/)及其[应用数据](https://deck.artofgamedesign.com/js/app.95e37080.js)核实。

| 维度 | 已核实名称 | 压缩评审问题 |
|---|---|---|
| 选择 | Meaningful Choices、Triangularity | 选择改变什么？是否有压倒其他选择的策略？风险与收益匹配吗？ |
| 能动性与技能 | Action、Freedom、Skill | 玩家实际能做什么、由此形成什么策略？限制和自由是否合适？技能能靠练习提高吗？ |
| 内生价值 | Endogenous Value | 玩家重视什么？游戏内价值与其动机如何关联？ |
| 平衡与挑战 | Balance、Challenge | 整体玩起来是否合适？难度是否随技能增长，容纳不同水平且有变化？ |
| 谜题 | The Puzzle、Accessibility、Visible Progress、Parallelism | 玩家知道从何开始吗？能看到进展吗？一道题失败是否堵住所有路径？谜题是否融入游戏？ |
| 界面 | Control、Virtual Interface、Transparency、Feedback | 操作符合预期吗？信息是否及时？压力下仍能操作吗？反馈是否帮助当前目标？ |
| 心理 | The Player、Curiosity、Flow | 玩家期待什么？是否有想追问的问题？目标是否明确、技能是否增长？ |
| 节奏 | Interest Curve | 是否有吸引点、升温与休息、高潮？预期曲线符合玩家实际兴趣吗？ |
| 叙事与世界 | Story、The World、Story Machine | 故事与玩法是否互相支持？世界能产生多种故事吗？玩家愿意讲述经历吗？ |
| 人物 | Character Function、Character Traits、Character Transformation | 人物承担什么作用？性格能从言行看出吗？变化可信吗？ |
| 原型与试玩 | Risk Mitigation、Playtesting | 最危险假设是什么？试玩要验证什么、找谁、观察什么、怎样收集证据？ |

官方应用的使用说明要求实际玩、找出问题、修改后再玩。这里的原型建议是据此推导：先以最小可玩实验验证关键体验，再扩充内容；不是核实到名为 Prototype 或 Iteration 的镜头。

## 可独立引用的官方文章

- [Goals](https://schellgames.com/blog/lens-of-goals)：目标应清晰，目标层次有关联，兼顾短期与长期，玩家可有自己的目标。
- [The Puzzle](https://schellgames.com/blog/lens-of-the-month-puzzle)：能核实官方镜头名称；页面正文主要是图片与视频，不能声称正文直接列出了全部问题。
- [Juiciness](https://schellgames.com/blog/the-lens-of-juiciness)：检查操作反馈是否持续，奖励能否同时通过多种方式被感知。
- [The Weirdest Thing](https://schellgames.com/blog/the-lens-of-the-weirdest-thing)：故事的新奇之处是否引起兴趣，又是否令玩家困惑。

## 使用限制

- Character 镜头指游戏的独特癖性、令人喜爱的怪处，不等同于人物塑造；后者用上表人物镜头。
- Balance 本身只有整体感受问题，不能冒充完整数值平衡算法；具体判断要结合挑战、选择与试玩证据。
- 镜头问题受版权保护。评审优先短转述并附官方链接；不要整套复制卡片。对同一来源英文逐字引用累计不超过 25 个词；翻译、转述也需节制。本表只保留诊断方向，详细问题请在官方应用阅读。
- 这份记录提供方法，尚不能证明本项目玩家实际有趣、难度适合或心理状态如何；这些结论仍需实际试玩观察。
- 能动性应按真实玩家操作评审：先区分玩家动作、AI 动作与自动系统动作，再问玩家选择影响了什么。不能把 AI 能打出的牌直接算作玩家的决策空间；这是评审应用建议，不是镜头原话。
