# Desk Drop 0.1：已确认的最小闭环

2026-10-26。用户已确认：拖入 Desk 使用原生嵌入形式，源 Block 留在原位置，不复制正文。

## 范围

- 独立 Roam Depot 插件；普通单个顶层 Block，从主 outline 或右侧 outline 拖到现有 Desk 行。
- 使用当前用户的 `:user/desk-page` 绑定；不猜页面名，不创建 Desk，不修改用户绑定。
- 新建 `{{embed-path: ((uid)) closed}}` 入口，放到 Desk 顶部。重复已有 embed / embed-path 入口不再添加。
- 原 Block 内容、父级、顺序和子块不变；不调用 move/update 源块。
- 保留 Desk 原来的点击行为。添加后不自动导航，不写剪贴板。
- 查看按需打开原生 Desk；撤销仅允许移除本次创建且未被改动、引用或添加子块的入口。不调用全局 undo。

## 本轮确认的测试接口

1. `DeskCapture.capture` / `undo`：通过真实数据适配模块连接模拟 Roam SDK，验证图谱中可观察的结果与原文不变。
2. `createDeskDropRuntime.start/stop`：通过浏览器事件验证接收区、普通拖动/修饰键让行、取消和卸载清理。
3. Roam SDK 适配模块：只模拟外部 SDK，不模拟本项目内部模块；约束实际调用形状和异常处理。

先做一个失败测试，再补对应实现；逐个增加安全边界。浏览器集成测试只使用本地内存图谱 fixture，不对正式 Roam 图谱做 drop 写入。

## 不包含

多顶层块、网页/文件/跨窗口拖入、跨图谱拖入、自动展开侧栏、手机触控手势、自动分类、AI、正式安装和发布。引用列表、查询和 embed 渲染暂不接管，以免第一版误认来源。

## 当前兼容依据

官方客户端 `0.13.13-2e4c3c7d` 的原生 Desk 写块格式和 `:user/desk-page` 绑定。它们不是已发布的稳定 Desk 专用 API，需在真实测试图谱中验证后才接入正式图谱。

官方拖拽载荷：`roam/block-uid-list-only-parents`、`roam/block-uid-list`、`roam/roam-uri-list`。使用公开的 `roamAlphaAPI.data.block.create/delete`、`data.pull/q`、`user.uid()`、`graph`、`util.generateUID()`；不调用混淆后的内部函数。

资料：
- https://roamdocs.fyi/developer-documentation/llms-full.txt
- https://roamresearch.com/js/compiled/main.js
- https://roamresearch.com/js/compiled/route-app.js

仅浏览器内会话级去重，不承诺跨设备分布式原子去重。无法确认的写入先读回，不自动重复创建。
