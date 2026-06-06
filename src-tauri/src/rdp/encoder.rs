use ironrdp_pdu::geometry::{InclusiveRectangle, Rectangle};
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
