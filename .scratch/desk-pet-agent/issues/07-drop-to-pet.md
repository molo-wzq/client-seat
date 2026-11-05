# 07 · 拖给它：素材入草稿

Status: done
Blocked by: 05

把录音、画像 JSON 或角色卡拖到桌宠上，系统产生 materials Trigger，素材或画像 Worker 起草后进入待审，复用现有素材库的人审发布流程。demo 模式下模拟处理进度。在待审卡上批注会唤醒原工单。

验收：故事 12、13；草稿不能直接上桌。

## Comments

- 2026-11-04：核心新增 kind=dropped（source=materials，Eval 校验 fileName+fileKind∈audio/persona/role）与 kind=annotate（data:{ticketId,note} 非空）；DemoWorker 素材草稿脚本分步推进 转写中→分析中→起草中（可注入定时器）落 waiting 草稿待审，批注对同一 ticketId 追加 progress→waiting（按批注改过的草稿），批注自身像决议一样是张小工单；守护测试（app-server 层）钉住拖入后素材库零新增零发布——草稿不能直接上桌，上桌仍走人审；DeskPet 拖入高亮「交给我」（暖黄 token），松手只发 fileName+fileKind（demo 不读内容、不上传），待审卡新增批注输入+「发批注」。相关测试 82/82 绿 + typecheck 通过；demo 模式（无 key）确定性可完整演示。

