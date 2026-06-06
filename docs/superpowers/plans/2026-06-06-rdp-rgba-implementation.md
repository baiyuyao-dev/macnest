# RDP RGBA Dirty-Rectangle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PNG full-frame encoding in the embedded RDP client with raw RGBA + dirty-rectangle updates to minimize CPU usage on LAN.

**Architecture:** Rust backend accumulates `GraphicsUpdate` regions, merges them each frame tick, copies raw RGBA bytes from `DecodedImage`, and emits a structured payload over Tauri events. Frontend decodes base64 to `Uint8ClampedArray` and uses `putImageData` to blit each dirty rectangle.

**Tech Stack:** Rust (ironrdp, image crate), TypeScript/React (Canvas 2D, Tauri event API)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src-tauri/src/rdp/encoder.rs` | Create | `FrameEncoder` trait, `FramePayload`, `RawRgbaEncoder`, region-merging utilities |
| `src-tauri/src/rdp/mod.rs` | Modify | Re-export `FrameEncoder`, `FramePayload`, `RawRgbaEncoder` |
| `src-tauri/src/rdp/session.rs` | Modify | Replace PNG encoding with dirty-region collection and `RawRgbaEncoder` |
| `src/components/rdp/RdpCanvas.tsx` | Modify | Parse new payload, decode base64 RGBA, render regions via `putImageData` |

---

## Task 1: Create `FrameEncoder` trait and `RawRgbaEncoder`

**Files:**
- Create: `src-tauri/src/rdp/encoder.rs`
- Modify: `src-tauri/src/rdp/mod.rs`

### Step 1.1: Write the encoder module

```rust
use anyhow::Context;
use ironrdp_pdu::geometry::InclusiveRectangle;
use ironrdp_session::image::DecodedImage;

#[derive(Debug, Clone)]
pub struct FramePayload {
    pub regions: Vec<InclusiveRectangle>,
    pub data: Vec<u8>,
}

pub trait FrameEncoder: Send + 'static {
    fn encode(
        &self,
        image: &DecodedImage,
        regions: &[InclusiveRectangle],
    ) -> anyhow::Result<FramePayload>;
}

pub struct RawRgbaEncoder;

impl FrameEncoder for RawRgbaEncoder {
    fn encode(
        &self,
        image: &DecodedImage,
        regions: &[InclusiveRectangle],
    ) -> anyhow::Result<FramePayload> {
        let stride = image.stride();
        let data = image.data();
        let mut payload = Vec::new();

        for region in regions {
            let width = usize::from(region.width());
            let height = usize::from(region.height());
            let left = usize::from(region.left);
            let top = usize::from(region.top);

            for row in 0..height {
                let src_start = (top + row) * stride + left * 4;
                let src_end = src_start + width * 4;
                payload.extend_from_slice(&data[src_start..src_end]);
            }
        }

        Ok(FramePayload {
            regions: regions.to_vec(),
            data: payload,
        })
    }
}

/// Merge overlapping or adjacent dirty rectangles to reduce region count.
pub fn merge_regions(regions: &[InclusiveRectangle]) -> Vec<InclusiveRectangle> {
    if regions.len() <= 1 {
        return regions.to_vec();
    }

    let mut merged: Vec<InclusiveRectangle> = regions.to_vec();
    merged.sort_by_key(|r| (r.left, r.top));

    let mut changed = true;
    while changed {
        changed = false;
        let mut next = Vec::with_capacity(merged.len());

        'outer: for current in merged.drain(..) {
            for existing in &mut next {
                if rectangles_intersect_or_adjacent(existing, &current) {
                    *existing = union_rectangle(existing, &current);
                    changed = true;
                    continue 'outer;
                }
            }
            next.push(current);
        }

        merged = next;
    }

    merged
}

fn rectangles_intersect_or_adjacent(a: &InclusiveRectangle, b: &InclusiveRectangle) -> bool {
    let a_left = i32::from(a.left);
    let a_top = i32::from(a.top);
    let a_right = i32::from(a.right);
    let a_bottom = i32::from(a.bottom);
    let b_left = i32::from(b.left);
    let b_top = i32::from(b.top);
    let b_right = i32::from(b.right);
    let b_bottom = i32::from(b.bottom);

    a_left <= b_right + 1
        && a_right >= b_left - 1
        && a_top <= b_bottom + 1
        && a_bottom >= b_top - 1
}

fn union_rectangle(a: &InclusiveRectangle, b: &InclusiveRectangle) -> InclusiveRectangle {
    InclusiveRectangle {
        left: a.left.min(b.left),
        top: a.top.min(b.top),
        right: a.right.max(b.right),
        bottom: a.bottom.max(b.bottom),
    }
}
```

### Step 1.2: Register module and exports

Modify `src-tauri/src/rdp/mod.rs` from:

```rust
pub mod manager;
pub mod network_client;
pub mod session;

pub use manager::RdpSessionManager;
pub use session::{InputEvent, SessionConfig};
```

To:

```rust
pub mod encoder;
pub mod manager;
pub mod network_client;
pub mod session;

pub use encoder::{FrameEncoder, FramePayload, RawRgbaEncoder};
pub use manager::RdpSessionManager;
pub use session::{InputEvent, SessionConfig};
```

### Step 1.3: Verify compilation

Run:

```bash
cd src-tauri && cargo check 2>&1 | tail -20
```

Expected: `Finished dev` with only pre-existing warnings.

### Step 1.4: Commit

```bash
git add src-tauri/src/rdp/encoder.rs src-tauri/src/rdp/mod.rs
git commit -m "feat(rdp): add FrameEncoder trait and RawRgbaEncoder" -m "Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Wire dirty-region encoding into the session loop

**Files:**
- Modify: `src-tauri/src/rdp/session.rs`

### Step 2.1: Remove PNG encoding and import encoder

Replace the top imports block of `session.rs` from:

```rust
use ironrdp_pdu::input::fast_path::{FastPathInputEvent, KeyboardFlags};
use ironrdp_pdu::input::mouse::{MousePdu, PointerFlags};
use ironrdp_graphics::image_processing::PixelFormat;
use image::ImageEncoder;
```

To (keeping other imports):

```rust
use ironrdp_pdu::input::fast_path::{FastPathInputEvent, KeyboardFlags};
use ironrdp_pdu::input::mouse::{MousePdu, PointerFlags};
use ironrdp_graphics::image_processing::PixelFormat;

use crate::rdp::encoder::{merge_regions, FrameEncoder, FramePayload, RawRgbaEncoder};
```

Remove the entire `encode_frame_png` function and the `use image::ImageEncoder;` import.

### Step 2.2: Change the frame event payload shape

In `manager.rs` the payload changes. We will emit an object instead of a string. Since Tauri's `Emitter::emit` takes `impl Serialize`, define a serializable payload struct in `manager.rs` or use a `serde_json::Value`. For simplicity, add a struct in `manager.rs`.

Add at the top of `src-tauri/src/rdp/manager.rs`:

```rust
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
struct FrameEventPayload {
    regions: Vec<RegionDto>,
    data: String,
}

#[derive(Debug, Clone, Serialize)]
struct RegionDto {
    left: u16,
    top: u16,
    right: u16,
    bottom: u16,
}

impl From<&ironrdp_pdu::geometry::InclusiveRectangle> for RegionDto {
    fn from(r: &ironrdp_pdu::geometry::InclusiveRectangle) -> Self {
        Self {
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
        }
    }
}
```

Change the frame forwarding block in `manager.rs` from:

```rust
Some(frame_data) => {
    let event_name = format!("rdp-frame-{}", session_id_clone);
    let base64_frame = base64::engine::general_purpose::STANDARD.encode(&frame_data);
    if let Err(e) = app_handle_clone.emit(
        &event_name, base64_frame) {
        eprintln!("[rdp] failed to emit frame: {}", e);
        break;
    }
}
```

To:

```rust
Some(payload) => {
    let event_name = format!("rdp-frame-{}", session_id_clone);
    let dto = FrameEventPayload {
        regions: payload.regions.iter().map(RegionDto::from).collect(),
        data: base64::engine::general_purpose::STANDARD.encode(&payload.data),
    };
    if let Err(e) = app_handle_clone.emit(&event_name, dto) {
        eprintln!("[rdp] failed to emit frame: {}", e);
        break;
    }
}
```

### Step 2.3: Update `active_stage_loop`

In `session.rs`, change the `active_stage_loop` signature and body.

Change:

```rust
fn active_stage_loop(
    connection_result: ConnectionResult,
    mut framed: UpgradedFramed,
    image: &mut DecodedImage,
    frame_tx: mpsc::Sender<Vec<u8>>,
    input_rx: &mut mpsc::Receiver<InputEvent>,
    shutdown: Arc<AtomicBool>,
) -> anyhow::Result<()> {
```

To:

```rust
fn active_stage_loop(
    connection_result: ConnectionResult,
    mut framed: UpgradedFramed,
    image: &mut DecodedImage,
    frame_tx: mpsc::Sender<FramePayload>,
    input_rx: &mut mpsc::Receiver<InputEvent>,
    shutdown: Arc<AtomicBool>,
) -> anyhow::Result<()> {
```

Inside the loop, replace the graphics-update handling block from:

```rust
let mut has_graphics_update = false;
for out in &outputs {
    match out {
        ActiveStageOutput::ResponseFrame(frame) => {
            framed.write_all(frame).context("write response")?;
        }
        ActiveStageOutput::GraphicsUpdate(_region) => {
            has_graphics_update = true;
        }
        ActiveStageOutput::Terminate(_) => break 'outer,
        _ => {}
    }
}

// Send frame if enough time has passed and there was a graphics update.
if has_graphics_update
    && last_frame_time.elapsed().as_millis() as u64 >= FRAME_SEND_INTERVAL_MS
{
    last_frame_time = std::time::Instant::now();

    match encode_frame_png(image) {
        Ok(png_data) => {
            if let Err(_e) = rt.block_on(frame_tx.send(png_data)) {
                eprintln!("[rdp] frame receiver dropped, shutting down session");
                break;
            }
        }
        Err(e) => {
            eprintln!("[rdp] failed to encode frame: {}", e);
        }
    }
}
```

To (declare `dirty_regions` before `'outer: loop` and accumulate across iterations):

Add before `'outer: loop`:
```rust
let mut dirty_regions: Vec<InclusiveRectangle> = Vec::new();
```

Replace the graphics-update handling block inside the loop:
```rust
for out in &outputs {
    match out {
        ActiveStageOutput::ResponseFrame(frame) => {
            framed.write_all(frame).context("write response")?;
        }
        ActiveStageOutput::GraphicsUpdate(region) => {
            dirty_regions.push(region.clone());
        }
        ActiveStageOutput::Terminate(_) => break 'outer,
        _ => {}
    }
}

// Send frame if enough time has passed and there are dirty regions.
if !dirty_regions.is_empty()
    && last_frame_time.elapsed().as_millis() as u64 >= FRAME_SEND_INTERVAL_MS
{
    last_frame_time = std::time::Instant::now();

    let encoder = RawRgbaEncoder;
    let merged = merge_regions(&dirty_regions);

    match encoder.encode(image, &merged) {
        Ok(payload) => {
            if let Err(_e) = rt.block_on(frame_tx.send(payload)) {
                eprintln!("[rdp] frame receiver dropped, shutting down session");
                break;
            }
        }
        Err(e) => {
            eprintln!("[rdp] failed to encode frame: {}", e);
        }
    }

    dirty_regions.clear();
}
```

### Step 2.4: Update `start_session` channel type

In `session.rs`, change:

```rust
let (frame_tx, frame_rx) = mpsc::channel::<Vec<u8>>(4);
```

To:

```rust
let (frame_tx, frame_rx) = mpsc::channel::<FramePayload>(4);
```

### Step 2.5: Verify compilation

Run:

```bash
cd src-tauri && cargo check 2>&1 | tail -20
```

Expected: `Finished dev` with only pre-existing warnings.

### Step 2.6: Commit

```bash
git add src-tauri/src/rdp/session.rs src-tauri/src/rdp/manager.rs
git commit -m "feat(rdp): emit raw RGBA dirty rectangles from session loop" -m "Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Update frontend to render RGBA regions

**Files:**
- Modify: `src/components/rdp/RdpCanvas.tsx`

### Step 3.1: Define payload type

Add near the top of `RdpCanvas.tsx`:

```typescript
interface RdpFramePayload {
  regions: Array<{ left: number; top: number; right: number; bottom: number }>;
  data: string;
}
```

### Step 3.2: Replace frame listener payload handler

Change the listener registration from:

```typescript
const unlisten = await listen<string>(eventName, (event) => {
  if (cancelled) return;
  const base64Data = event.payload;
  const img = new Image();
  img.onerror = () => {
    if (cancelled) return;
    console.error("RDP frame decode failed");
  };
  img.onload = () => {
    if (cancelled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    if (status !== "connected") {
      setStatus("connected");
    }
  };
  img.src = `data:image/png;base64,${base64Data}`;
});
```

To:

```typescript
const unlisten = await listen<RdpFramePayload>(eventName, (event) => {
  if (cancelled) return;
  const payload = event.payload;
  const canvas = canvasRef.current;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  try {
    const binary = atob(payload.data);
    const bytes = new Uint8ClampedArray(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    let offset = 0;
    for (const region of payload.regions) {
      const width = region.right - region.left;
      const height = region.bottom - region.top;
      const regionSize = width * height * 4;
      const regionBytes = bytes.subarray(offset, offset + regionSize);
      const imageData = new ImageData(regionBytes, width, height);
      ctx.putImageData(imageData, region.left, region.top);
      offset += regionSize;
    }

    if (status !== "connected") {
      setStatus("connected");
    }
  } catch (err) {
    console.error("RDP frame render failed:", err);
  }
});
```

### Step 3.3: Verify TypeScript compilation

Run:

```bash
npx tsc --noEmit
```

Expected: no errors.

### Step 3.4: Commit

```bash
git add src/components/rdp/RdpCanvas.tsx
git commit -m "feat(rdp): render raw RGBA dirty rectangles in canvas" -m "Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Integration smoke test

**Files:**
- None (manual verification)

### Step 4.1: Build Rust

```bash
cd src-tauri && cargo build 2>&1 | tail -5
```

Expected: `Finished dev` successfully.

### Step 4.2: Build frontend

```bash
npm run build 2>&1 | tail -5
```

Expected: no TypeScript/build errors.

### Step 4.3: Manual RDP connection test

1. Temporarily uncomment the RDP menu in `src/components/Layout.tsx` if needed to access the RDP page.
2. Run the Tauri app: `npm run tauri dev`
3. Create an RDP connection pointing at a reachable Windows host.
4. Click "内嵌连接".
5. Observe:
   - Canvas renders the desktop.
   - Moving the mouse over the canvas sends mouse input and the remote cursor moves.
   - CPU usage in Activity Monitor is significantly lower than before.
   - Session stays connected for > 60 seconds without dropping.

If the test fails, check the Rust stderr log for errors and the browser DevTools console for payload parsing errors.

### Step 4.4: Commit (if test passes)

```bash
git commit -m "test(rdp): verify RGBA dirty-rectangle rendering end-to-end" -m "Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Spec Coverage Checklist

| Spec Section | Task | Status |
|---|---|---|
| FrameEncoder trait / RawRgbaEncoder | Task 1 | Planned |
| Dirty region collection & merging | Task 2 | Planned |
| Remove PNG encoding | Task 2 | Planned |
| Event payload shape `{ regions, data }` | Task 2 | Planned |
| Frontend RGBA decode + putImageData | Task 3 | Planned |
| Manual CPU/latency validation | Task 4 | Planned |

---

## Notes for Implementer

- The `ironrdp_pdu::geometry::InclusiveRectangle` is inclusive on all sides, so `width = right - left` and `height = bottom - top` are correct as used in ironrdp internals.
- `merge_regions` is intentionally simple (O(n²) worst case). Typical RDP dirty regions per frame are small (<20), so this is fine for 1080p@30fps.
- If the payload is too large for a single Tauri event on some systems, split it in Task 2.3 by emitting multiple events per region. This is unlikely on LAN for 1080p.
- Do not add an `encoder_type` field or other encoders yet — YAGNI until a second encoder is actually implemented.
