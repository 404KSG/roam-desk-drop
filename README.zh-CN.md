# Desk Drop

把一个 Roam Block 从主大纲或右侧大纲拖到左侧 **Desk**，加入原生嵌入引用。原 Block 留在原处，不复制正文，不搬移子块。

[English](https://github.com/404KSG/roam-desk-drop#readme)

**状态：0.1.0 原型，用于 Roam Depot Draft PR 评审。代码、模拟图谱测试及本地浏览器测试已完成；尚未正式上架，也未安装到正式图谱。真实测试图谱的写入验收仍需单独确认。**

## 行为

1. 不按修饰键，从 Block 的圆点开始拖动。
2. 移到左侧 Desk 整行，出现“放入 Desk · 原文保留”。
3. 松手后，在当前用户绑定的 Desk 顶部创建：

```text
{{embed-path: ((BLOCK_UID)) closed}}
```

4. 读回确认后，显示“已加入 Desk”，可按需查看或撤销；不自动导航，也不改剪贴板。

这是实时嵌入，不是备份副本：在 Desk 中编辑源内容会影响原 Block。重复拖入不会新增或重排旧条目。卸载插件后，已加入的条目仍是原生 Roam 内容，可从原生 Desk 处理。

## 范围与安全

- 当前仅支持同一窗口、同一 graph 的单个顶层 Block；Block 原有子块随原生嵌入展示，不被复制。
- 普通主大纲、右侧 outline / block outline 可作为来源。
- 多选多个顶层块、页面、外部文字/文件、跨窗口、跨图谱、引用列表、查询结果和嵌入视图暂不接管。
- Option / Command / Control / Shift 拖拽全部让行。已做事件让行测试，但与真实 Drag References 插件共存仍须在测试图谱验收。
- 不创建 Desk、不猜名称、不写用户绑定；Desk 未初始化或已失效时提示使用原生 Desk。
- 拒绝 Desk 自身以及 Desk 页内部的块。复杂动态渲染和跨块嵌入的全局环检测不在本原型保证范围内。
- 源块没有 move/update/delete 路径。唯一 delete 操作来自用户明确点击“撤销”，只针对本次创建的入口。
- 入口被编辑、移动、引用或添加子块后，撤销会拒绝；不调用全局 Undo。
- 写入报错后按预生成 UID 读回，不能确认时暂停该块的重试，不盲目再创建。
- 仅提供插件实例内的串行去重，不承诺多设备分布式原子去重或原子条件删除。
- 卸载会停止新操作并清理监听和 UI；已经提交给 Roam 的操作无法强行撤回，未确认结果应回原图谱核对。
- 不调用 AI，不要求新增 API Key，不接入外部服务或分析统计；不主动发起额外网络请求，图谱变更仍沿用 Roam 自身同步。Desk 仍遵循 graph 的原有权限，不是独立的私密空间。

## 文件

- `extension.js`：已构建的 Roam Depot ESM 模块；不是 CSS，也不能直接当普通脚本粘贴到 `roam/js`。
- `src/desk-capture.js`：校验、去重、写入读回和撤销。
- `src/roam-adapter.js`：公开 Roam SDK 调用，以及 Desk 绑定的兼容层。
- `src/drop-payload.js`：官方拖拽载荷校验。
- `src/runtime.js` / `src/ui.js`：Desk 接收区、提示和生命周期清理。
- `test/fixtures/`：完全独立的内存图谱测试页，不连接真实 Roam。
- `docs/design.md`：已确认的范围和测试接口。
- `docs/verification.md`：验证记录和真实图谱待验收项。

## 本地验证

Node.js 20 或更高版本：

```bash
npm test
npm run fixture
```

打开 `http://127.0.0.1:4381/` 测试源码入口，或打开 `http://127.0.0.1:4381/?bundle=1` 测试 `extension.js`。测试页中的拖拽、查看、撤销只作用于内存数据。

构建需要 esbuild 0.28.1。可使用已安装的开发依赖，或指定本机已有的 esbuild：

```bash
ESBUILD_BIN=/absolute/path/to/esbuild npm run build
npm run check
```

本次构建复用了本机已安装的 esbuild，没有安装新软件。脚本不会自动下载依赖。

## 真实测试图谱验收（尚未执行）

- [ ] 指定一个独立测试图谱，先打开原生 Desk 初始化。
- [ ] 经明确确认后通过 Roam 的开发扩展入口载入 `extension.js`，不要直接部署到正式图谱。
- [ ] 用一个带子块的测试 Block 比较“原生 Add to Desk”和拖入插件后的结果。
- [ ] 核对原文、UID、父级、顺序、子块均未改变，原生 Desk 能正常显示和移除入口。
- [ ] 核对重复拖入、图谱切换、编辑后的撤销拒绝、卸载清理。
- [ ] 与实际 Drag References 的四种修饰键手势共存测试。
- [ ] 分别验证 Roam 网页版和桌面端。

## 兼容依据

当前 Desk 绑定字段 `:user/desk-page` 和嵌入格式来自 Roam 客户端 `0.13.13-2e4c3c7d`，并非正式稳定的 Desk 专用 API；升级后需重新验证。数据操作使用公开 `roamAlphaAPI.data` 接口，不调用混淆后的内部函数。

- [官方开发者文档](https://roamresearch.com/#/app/developer-documentation)
- [机器可读文档镜像](https://roamdocs.fyi/developer-documentation/llms-full.txt)
- [当前官方 Desk 实现](https://roamresearch.com/js/compiled/main.js)
