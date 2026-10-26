# 0.1.0 原型验证记录

日期：2026-10-26。

## 已通过

| 项目 | 结果 | 证据 |
|---|---|---|
| Node 自动化测试 | 37 项通过 | `npm test`，覆盖原生嵌入、源块不变、去重、撤销、图谱切换、取消、绑定变化、未知写入结果及载荷校验 |
| 浏览器集成测试（源码） | 10 项通过 | `artifacts/browser-tests.json` |
| 浏览器集成测试（打包产物） | 同一组 10 项通过 | `artifacts/browser-tests.json` 的 bundle 结果 |
| 原生鼠标拖拽 | dragstart/drop 的 `isTrusted` 均为 true；dropEffect 为 link | `artifacts/native-drag.json` |
| 点击撤销 | 仅移除新增入口，源 Block 与子块保留 | 原生拖拽记录及 Node 测试 |
| 只读 Roam 接口检查 | 所需公开方法、用户 Desk 绑定、父级/page 元数据及时间字段均存在；graph 名与原生 URL 一致 | `artifacts/read-only-compatibility.json`，未调用 create/delete |
| 构建和静态检查 | 通过；未引入外部网络调用或源块 move/update 调用 | `npm run check` |
| 构建可复现 | 两次构建哈希相同 | 下方 SHA256 |

`extension.js` SHA256：

```text
9aa359e3f7f55aa5b9e2627ca76aa6ddb500053ce92428ad651fcce7af3a3c45
```

本次使用本机已有的 esbuild 0.28.1；未安装新的依赖。浏览器测试使用独立 localhost 内存图谱，所有模拟 create/delete 只改变 JavaScript 内存对象。只读兼容检查没有把插件加载到真实 Roam 页面。

`artifacts/` 是不入库的本地验证产物；公开仓库包含可重跑的测试和内存图谱 fixture。脱敏后的沙盒演示截图位于 `assets/desk-drop-sandbox.png`，不是正式图谱截图。

## 尚未完成的发布门槛

- 真实独立测试图谱中的原生 Add to Desk 对照、拖入写入、实时嵌入显示及原生移除。
- 真实 Roam 网页版 / Electron 桌面端的完整拖放回归。
- 与实际已加载 Drag References 的联合运行；当前只验证了本插件对修饰键事件让行。
- 真实只读图谱、同步中断和跨设备并发场景。

因此这是**待真实测试图谱验收的原型**。Roam Depot 提交应保持 Draft，直到上述验收完成。源码公开或生成 PR 测试预览不等于正式上架；本次未安装到正式图谱。

## 安全范围

第一版只接受同窗口、同 graph、普通 outline 中的单个顶层 Block。公开接口没有事务级条件删除或全局唯一引用约束，因此前置校验与本实例串行化不能替代分布式原子性。已交给 Roam 的变更也不能通过卸载插件强行取消。
