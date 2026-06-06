# RDP 内嵌客户端重构设计：RGBA 脏矩形方案

## 背景

当前实现使用 PNG 整帧编码把每一帧画面推送到前端，CPU 占用高、延迟大，无法支撑长期使用的 RDP 内嵌会话。

## 目标

替换 PNG 整帧编码为 **原始 RGBA + 脏矩形** 传输方案：
- 目标分辨率：1920x1080 @ 30fps
- 使用场景：局域网/内网
- 最高优先级：最低 CPU 占用
- 先支持 1 个会话，接口预留多会话扩展

## 架构

```
Rust Backend
  IronRDP ActiveStage → DecodedImage (RGBA, w×h×4)
           ↓
  RegionCollector: 合并/去重 GraphicsUpdate(region)
           ↓
  FrameEncoder trait → RawRgbaEncoder (当前实现)
           ↓
  EventEmitter: rdp-frame-{session_id}
           payload: { regions: Rect[], data: base64 }

Frontend (React)
  listen(rdp-frame-{id})
           ↓
  FrameDecoder → ImageBitmap / Uint8ClampedArray
           ↓
  Canvas 2D putImageData / drawImage
```

## Rust 后端

### FrameEncoder trait

```rust
pub struct FramePayload {
    pub regions: Vec<InclusiveRectangle>,
    pub data: Vec<u8>, // 连续 RGBA 像素
}

pub trait FrameEncoder: Send + 'static {
    fn encode(&self, image: &DecodedImage, regions: &[InclusiveRectangle]) -> anyhow::Result<FramePayload>;
}
```

### 主循环改动

- 维护 `dirty_regions: Vec<InclusiveRectangle>`
- 收到 `GraphicsUpdate(region)` 时加入脏区列表
- 每 33ms 触发一次编码：
  - 脏区为空 → 不发帧
  - 合并相交/相邻矩形
  - 调用 `RawRgbaEncoder::encode`
- 不再调用 `encode_frame_png`

### 事件负载

事件名保持 `rdp-frame-{session_id}`，payload 结构：

```json
{
  "regions": [
    { "left": 0, "top": 0, "right": 1920, "bottom": 1080 }
  ],
  "data": "<base64>"
}
```

- `data` 按 `regions` 顺序拼接
- 每个 region 数据量为 `width * height * 4` 字节
- 颜色格式：RGBA

## 前端改动

### RdpCanvas.tsx

- 监听事件拿到 `{ regions, data }`
- base64 decode 为 `Uint8ClampedArray`
- 构造 `ImageData`
- 对每个 region 调用 `ctx.putImageData(imageData, left, top)`
- 添加 `ImageBitmap` 分支作为性能备选

Canvas 尺寸保持原样：`width={screen_width} height={screen_height}`。

## 性能预期

| 指标 | 当前 PNG | 新方案 |
|---|---|---|
| CPU（后端） | 高（PNG encode） | 低（仅内存拷贝） |
| CPU（前端） | 中（PNG decode） | 低（putImageData） |
| 带宽 | 整帧压缩后仍大 | 仅脏矩形原始 RGBA |
| 延迟 | 高 | < 40ms |

## 扩展性

未来增加 JPEG/WebP/H.264 时：
1. 实现新的 `FrameEncoder`
2. 前端增加对应的 `FrameDecoder`
3. 连接配置里增加 `encoder_type` 字段
4. 主循环不需要改动

## 错误处理

- 编码失败：记录日志，跳过该帧
- 前端解码失败：控制台报错，toast 提示用户
- IPC 单包过大：拆成多个事件发送

## 测试计划

- 连接 Windows 桌面，打开窗口、拖动、鼠标点击
- 使用 Activity Monitor 观察 Rust 进程 CPU
- 使用 DevTools Performance 观察前端渲染耗时
- 验证长时间空闲不断连

## 关键文件

- `src-tauri/src/rdp/session.rs`
- `src-tauri/src/rdp/encoder.rs`（新增）
- `src/components/rdp/RdpCanvas.tsx`
- `src/lib/api.ts`
