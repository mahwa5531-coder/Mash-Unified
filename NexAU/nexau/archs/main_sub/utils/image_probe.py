# Copyright (c) Nex-AGI. All rights reserved.
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
# http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Image header probing + official token estimation, shared by the token
counter and the read-tool downscale step.

Incident fix (session bf6ef5c923ce; Rust counterpart nexau-rs#94): both the
token estimator (`token_counter._estimate_image_tokens`) and the read-tool
downscale step (`read_visual_file`) need an image's real pixel dimensions -
the former to charge context cost, the latter to decide the exact target size
that keeps one image within its token budget. Parsing the format header is
enough for both: no full pixel decode, no image-codec dependency.

Token cost uses Anthropic's official patch formula
(`estimate_tokens_from_dimensions`); it lives here so the counter and the
downscaler cannot drift apart inside this repo, and the same 28px patch size
must stay in sync with the Rust `nexau-rs` runtime by convention.
"""

import base64
import binascii
import logging
import math
import struct
from collections.abc import Sequence
from io import BytesIO
from typing import Final

from PIL import Image

logger = logging.getLogger(__name__)

# Anthropic's official vision token formula is patch-based: an image is tiled
# into 28x28-pixel patches and costs one token per patch -
# ceil(width/28) * ceil(height/28), i.e. 784 pixels per token (older docs'
# pixels/750 was an approximation; the patch formula matched northgate
# measurements to ±1 token across five sizes on 2026-07-07). We charge context
# cost at this official rate rather than a worst-channel calibration: images
# emitted by the read tools are already downscaled to a per-image token budget
# (`read_visual_file`, in official-formula tokens), so counting them by the
# same formula is exactly consistent. Keep the patch size in sync with the
# Rust `nexau-rs` runtime (token_counter.rs).
IMAGE_TOKEN_PATCH_SIZE: Final[int] = 28


def estimate_tokens_from_dimensions(width: int, height: int) -> int:
    """Official Anthropic vision token cost for a ``width x height`` image.

    One token per 28x28-pixel patch: ``ceil(w/28) * ceil(h/28)``. This is the
    server-side *pre-downscale* cost; a caller wanting the billed cost of an
    already-capped image passes the capped dimensions. A non-empty image never
    costs 0 (each axis contributes at least one patch).
    """
    if width <= 0 or height <= 0:
        return 0
    return math.ceil(width / IMAGE_TOKEN_PATCH_SIZE) * math.ceil(height / IMAGE_TOKEN_PATCH_SIZE)


# Every SOFn variant shares the `[precision:1][height:2 BE][width:2 BE]...`
# payload layout; DHT/DAC/RSTn/SOI/EOI are deliberately excluded.
_JPEG_SOF_MARKERS: Final[frozenset[int]] = frozenset({0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF})


def probe_dimensions(data: bytes) -> tuple[int, int] | None:
    """Parse ``(width, height)`` from a (possibly truncated) image header.

    Tries each format nexau's own image tools emit (PNG, JPEG, GIF, BMP,
    WebP - the WebP prober mirrors nexau-rs so both runtimes classify the
    same bytes identically); an unrecognized or malformed header yields
    ``None``, which callers must treat as "size unknown - act
    conservatively", never as zero.
    """
    return (
        _probe_png_dimensions(data)
        or _probe_jpeg_dimensions(data)
        or _probe_gif_dimensions(data)
        or _probe_bmp_dimensions(data)
        or _probe_webp_dimensions(data)
    )


def _probe_webp_dimensions(data: bytes) -> tuple[int, int] | None:
    # RIFF container: "RIFF"[size:4]"WEBP" then a VP8 / VP8L / VP8X chunk.
    # Ported from nexau-rs `probe_webp_dimensions` for byte-for-byte parity.
    if len(data) < 30 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return None
    chunk = data[12:16]
    if chunk == b"VP8X":
        # Extended: 24-bit LE canvas width/height minus one, at offset 24/27.
        width = 1 + (data[24] | (data[25] << 8) | (data[26] << 16))
        height = 1 + (data[27] | (data[28] << 8) | (data[29] << 16))
        return width, height
    if chunk == b"VP8L":
        # Lossless: signature byte 0x2f then 14-bit width-1 / height-1.
        if data[20] != 0x2F:
            return None
        bits = struct.unpack("<I", data[21:25])[0]
        return 1 + (bits & 0x3FFF), 1 + ((bits >> 14) & 0x3FFF)
    if chunk == b"VP8 ":
        # Lossy: frame tag (3B) + start code 9D 01 2A + 16-bit LE dims (14 bits used).
        if data[23] != 0x9D or data[24] != 0x01 or data[25] != 0x2A:
            return None
        width, height = struct.unpack("<HH", data[26:30])
        return int(width) & 0x3FFF, int(height) & 0x3FFF
    return None


def _probe_png_dimensions(data: bytes) -> tuple[int, int] | None:
    # 8-byte signature, then the IHDR chunk is always first:
    # [len:4][type:4="IHDR"][width:4 BE][height:4 BE]...
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", data[16:24])
    return int(width), int(height)


def _probe_gif_dimensions(data: bytes) -> tuple[int, int] | None:
    # "GIF87a"|"GIF89a" then the logical screen descriptor: [width:2 LE][height:2 LE].
    if len(data) < 10 or data[:6] not in (b"GIF87a", b"GIF89a"):
        return None
    width, height = struct.unpack("<HH", data[6:10])
    return int(width), int(height)


def _probe_bmp_dimensions(data: bytes) -> tuple[int, int] | None:
    # "BM" file header, then the DIB header. Its size field (offset 14, u32 LE)
    # discriminates the family: the legacy OS/2 BITMAPCOREHEADER (size 12)
    # stores width/height as u16 at offset 18/20, while the BITMAPINFOHEADER
    # family (V1/V4/V5, size >= 40) stores signed 32-bit LE at 18/22 (negative
    # height = top-down row order; magnitude is what we need). Parsing a CORE
    # header with the INFO layout used to fuse two u16 fields into a trillion-
    # pixel reading and mis-omit legitimate small images.
    if len(data) < 26 or data[:2] != b"BM":
        return None
    header_size = struct.unpack("<I", data[14:18])[0]
    if header_size == 12:
        width, height = struct.unpack("<HH", data[18:22])
        return int(width), int(height)
    width, height = struct.unpack("<ii", data[18:26])
    return abs(int(width)), abs(int(height))


def _probe_jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    # Scan segments from the SOI marker for a Start-Of-Frame marker and read its
    # height/width, skipping every other segment by its declared length. Bounded
    # by the caller-supplied bytes, so a truncated tail (SOF not yet reached)
    # safely yields None rather than reading out of bounds.
    if len(data) < 4 or data[0] != 0xFF or data[1] != 0xD8:
        return None
    pos = 2
    length = len(data)
    while pos + 9 <= length:
        if data[pos] != 0xFF:
            return None  # not aligned on a marker boundary - bail rather than mis-scan
        marker = data[pos + 1]
        # Fill byte between markers: advance one and re-align.
        if marker == 0xFF:
            pos += 1
            continue
        # Standalone markers carry no length payload: TEM (0x01) and RSTn/SOI/EOI (0xD0-0xD9).
        if marker == 0x01 or 0xD0 <= marker <= 0xD9:
            pos += 2
            continue
        segment_len = struct.unpack(">H", data[pos + 2 : pos + 4])[0]
        if marker in _JPEG_SOF_MARKERS:
            height, width = struct.unpack(">HH", data[pos + 5 : pos + 9])
            return int(width), int(height)
        pos += 2 + int(segment_len)
    return None


# ---------------------------------------------------------------------------
# Pixel-area budget + downscale geometry
# Incident fix (session bf6ef5c923ce; Rust counterpart nexau-rs#94): the same
# per-image token budget both the read tool (`read_visual_file`, via ffmpeg)
# and the persistence-time in-memory resize (`resize_base64_image_if_oversized`
# via Pillow) cap images against. Kept here - the shared low-level image module
# already the single source of the token-cost formula - so the read path, the
# persist path and the token counter can't drift to different exchange rates.
# The official Anthropic vision formula is patch-based: an image costs
# ceil(width/28) x ceil(height/28) visual tokens - one token per 28x28-pixel
# patch, i.e. 784 pixels per token. Per-image ceilings are tier-dependent;
# high-resolution models (Opus 4.7/4.8, Fable 5) allow ≤2576px / ≤4_784 tokens.
# Gateway channels implement those caps inconsistently, so we enforce the bound
# client-side. Budgets are denominated in official-formula tokens - the same
# formula `token_counter` charges context cost with - so a budgeted image and
# its accounted cost agree. Keep in sync with the Rust `nexau-rs` constants.
# ---------------------------------------------------------------------------
OFFICIAL_PIXELS_PER_TOKEN: Final[int] = 784

# Per-image token budget applied when no explicit cap is given. 4_784 matches
# the official high-resolution tier's own per-image ceiling - the tier the
# production model (claude-opus-4-8) is in: 4_784 x 784 ≈ 3.75 megapixels.
DEFAULT_IMAGE_TOKEN_BUDGET: Final[int] = 4_784

# Pixel-area ceiling derived from the default budget. Bounding area - not edge
# length - matches how token cost scales: an area cap prices every aspect ratio
# identically.
DEFAULT_IMAGE_MAX_PIXELS: Final[int] = DEFAULT_IMAGE_TOKEN_BUDGET * OFFICIAL_PIXELS_PER_TOKEN

# base64: header prober
# , . `token_counter._PROBE_PREFIX_BASE64_CHARS` --
# module import, `token_counter` module, import
# . PNG 24, JPEG SOF KB, GIF/BMP
# , 200_000 base64 ( 150KB ) .
_PROBE_PREFIX_BASE64_CHARS: Final[int] = 200_000

# : header value. (default
# 3.75MP), Pillow DecompressionBomb defaultvalue (`Image.MAX_IMAGE_PIXELS`
# ≈ 89.5MP), "header, " (
# PNG), Image.open→convert→resize MB . prober
# (webp/tiff ) Pillow bomb .
# `image_exceeds_hard_limit`: omit ( resize, )
# `resize_base64_image_if_oversized` .
# : `read_visual_file` 60MP value"
# ffmpeg, failure " -- omit
# value, omit. Rust `nexau-rs`
# `OVERSIZED_IMAGE_PIXELS` .
OVERSIZED_IMAGE_PIXELS: Final[int] = 60_000_000
_MAX_DECODE_PIXELS: Final[int] = OVERSIZED_IMAGE_PIXELS

# (20 MiB): `read_visual_file`
# (decode/base64/), ffmpeg
# read-only; ffmpeg . `MAX_IMAGE_BASE64_BYTES` (
# base64 gate, 20 MiB base64 ≈ 15 MiB ):
# . Rust `nexau-rs` `OVERSIZED_IMAGE_FILE_SIZE_BYTES` .
OVERSIZED_IMAGE_FILE_SIZE_BYTES: Final[int] = 20 * 1024 * 1024

# base64 string: 20 MiB **** gate
# (ceil(20MiB/3)*4 ≈ 26.7M base64 ). 20MiB (≈15.7MiB
# ) 4/3, 15.7-20MB: graceful
# omit,success.
# : omit, 20MB fail-closed.
# omit, decode .
MAX_IMAGE_BASE64_BYTES: Final[int] = -(-(20 * 1024 * 1024) // 3) * 4

OVERSIZED_IMAGE_PLACEHOLDER: Final[str] = "image content omitted because it exceeded the supported size limit; use a smaller image"


def floor_even_dimension(value: float) -> int:
    """Floor ``value`` to an even pixel count (minimum 2).

    ffmpeg's default mjpeg pixel format uses 4:2:0 chroma subsampling, which
    requires even dimensions; flooring (never rounding up) keeps every cap
    guarantee intact (an even-floored dimension is <= the exact scaled one).
    Pillow's JPEG encoder tolerates odd dimensions, but we floor-even here too
    so the persist path and the read path land on identical target sizes.
    """
    floored = math.floor(value)
    return max(2, floored - (floored % 2))


# :Anthropic API >8000px, patch
# ceil(w/28)*ceil(h/28) -- 4,000,000×1 4MP
# ~14 token. " resize".
# Rust `nexau-rs` .
MAX_TARGET_LONG_EDGE: Final[int] = 8000


def area_capped_dimensions(width: int, height: int, max_pixels: int) -> tuple[int, int] | None:
    """Target dimensions for a pixel-area + long-edge cap, or ``None`` if within both.

    Scale = min(area scale, long-edge scale):both dimensions shrink by the
    same factor and floor to even. The ``floor_even_dimension`` 2px minimum
    can inflate a degenerate side (e.g. height 0.004 → 2), silently blowing
    the area bound for extreme aspect ratios - the post-clamp check re-caps
    the governing side so the guarantee ``target_area <= max_pixels`` holds
    for every input, which also keeps both sides far below JPEG's 65,535
    encodable limit.
    """
    pixels = width * height
    long_edge = max(width, height)
    if pixels <= max_pixels and long_edge <= MAX_TARGET_LONG_EDGE:
        return None
    scale = min(1.0, math.sqrt(max_pixels / pixels), MAX_TARGET_LONG_EDGE / long_edge)
    target_w = floor_even_dimension(width * scale)
    target_h = floor_even_dimension(height * scale)
    # min-2 clamp:.
    if target_w * target_h > max_pixels:
        if target_w >= target_h:
            target_w = floor_even_dimension(max_pixels / target_h)
        else:
            target_h = floor_even_dimension(max_pixels / target_w)
    return target_w, target_h


def _probe_dimensions_from_b64_prefix(b64_data: str) -> tuple[int, int] | None:
    """Probe ``(width, height)`` from only a bounded base64 *prefix*.

     ``token_counter._probe_image_dimensions``: 
    ``_PROBE_PREFIX_BASE64_CHARS``, 
     MB . ``None``  header  (, 
    / header)  -- . 
    """
    if not b64_data:
        return None
    prefix_len = min(len(b64_data), _PROBE_PREFIX_BASE64_CHARS)
    # base64 4 ; 4, "invalid length".
    prefix = b64_data[: prefix_len - (prefix_len % 4)]
    try:
        raw = base64.b64decode(prefix, validate=False)
    except (ValueError, binascii.Error):
        return None
    return probe_dimensions(raw)


def probe_b64_prefix_dimensions(b64_data: str) -> tuple[int, int] | None:
    """Public prefix-probe: base64, ``None``. 

    (``history_list``) mime  ``base64`` 
      --, omit/resize. 
    """
    return _probe_dimensions_from_b64_prefix(b64_data)


def _is_animated_image(img: Image.Image) -> bool:
    """``img``  (animated GIF / WebP / APNG) . 

    class ``seek`` / ``EOFError``,  ``n_frames`` / ``is_animated``
    property:  plugin class (GifImageFile / WebPImageFile /
     acTL  PngImageFile), type ``Image.Image``  pyright strict
    propertyerror,  ``getattr`` . ``seek`` class
    ``Image``  ( plugin  override ), type. 
     seek  frame 0, . 
    """
    try:
        img.seek(1)
    except EOFError:
        return False
    img.seek(0)
    return True


def image_exceeds_hard_limit(b64_data: str) -> bool:
    """Whether an image must be *omitted* wholesale rather than resized.

     size  gate  --  completed,  decode  + 
    payload: 

    1. base64 string > ``MAX_IMAGE_BASE64_BYTES`` (20 MiB):  True, 
       ``base64.b64decode``   --   decode,  history payload 
       ; 
    2.  ``_PROBE_PREFIX_BASE64_CHARS``  header prober,  >
       ``_MAX_DECODE_PIXELS`` (60 MP): True,  ``Image.open→convert→resize`` 
       ", " MB . 

    prober  (webp/tiff ),  base64 
    gate,  ``resize_base64_image_if_oversized``  Pillow 
    DecompressionBomb .  True, 
    ``OVERSIZED_IMAGE_PLACEHOLDER`` ;  False, 
    ``resize_base64_image_if_oversized`` . 
    """
    if len(b64_data) > MAX_IMAGE_BASE64_BYTES:
        logger.warning(
            "Omitting oversized image: base64 length %d chars exceeds hard limit %d; not decoding",
            len(b64_data),
            MAX_IMAGE_BASE64_BYTES,
        )
        return True
    probed = _probe_dimensions_from_b64_prefix(b64_data)
    if probed is None:
        # header prober ( SOF EXIF JPEG
        # TIFF ): Pillow lazy open -- `Image.open`
        # header,.,
        # gate, `resize_base64_image_if_oversized`
        # Pillow ( bomb value ~179MP gate 60MP).
        probed = _pillow_header_dimensions_from_b64_prefix(b64_data)
    if probed is not None and probed[0] * probed[1] > _MAX_DECODE_PIXELS:
        logger.warning(
            "Omitting oversized image: probed %dx%d = %d px exceeds decode guard %d px",
            probed[0],
            probed[1],
            probed[0] * probed[1],
            _MAX_DECODE_PIXELS,
        )
        return True
    return False


def _pillow_header_dimensions_from_b64_prefix(b64_data: str) -> tuple[int, int] | None:
    """Header-only dimension probe via Pillow's lazy ``Image.open``.

     ``_probe_dimensions_from_b64_prefix``  base64 ;
     Pillow  header  ``None``(,
    ``resize_base64_image_if_oversized``  open ). 
    """
    if not b64_data:
        return None
    prefix_len = min(len(b64_data), _PROBE_PREFIX_BASE64_CHARS)
    prefix = b64_data[: prefix_len - (prefix_len % 4)]
    try:
        raw = base64.b64decode(prefix, validate=False)
        with Image.open(BytesIO(raw)) as img:
            return img.width, img.height
    except Exception:
        return None


def resize_base64_image_if_oversized(b64_data: str, mime_type: str) -> tuple[str, str] | None:
    """Downscale an over-budget base64 image entirely in memory (Pillow).

:  ``read_visual_file`` default  -- 
     ``DEFAULT_IMAGE_MAX_PIXELS``,  ``area_capped_dimensions``
      --   sandbox / ffmpeg /, 
    ``HistoryList``  (, /
    MCP ) . 

     ``image_exceeds_hard_limit``:  (base64 > 20 MiB  >
    ``_MAX_DECODE_PIXELS``)  omit, function  --  function 60 MP, 
     prober . 

    Args:
        b64_data:  base64 ( ``data:`` ) . 
        mime_type:  MIME (; / Pillow ) . 

    Returns:
        ``(new_base64, "image/jpeg")``,, 
        ``DEFAULT_IMAGE_MAX_PIXELS`` ;  ``None`` . 
        ``None`` ( no-op / ): base64,, 
         (, ), /failure  --, 
         fail. 
    """
    # 1.: base64 header prober (PNG/JPEG/GIF/
    # BMP, read_visual_file / token_counter ) .
    # → None, . replace_all
    # , /. ( > 60 MP)
    # ``image_exceeds_hard_limit`` omit, ; prober
    # (webp/tiff ) Pillow .
    probed = _probe_dimensions_from_b64_prefix(b64_data)
    if probed is not None and probed[0] * probed[1] <= DEFAULT_IMAGE_MAX_PIXELS and max(probed) <= MAX_TARGET_LONG_EDGE:
        return None

    # 2.: prober .
    try:
        raw = base64.b64decode(b64_data)
    except Exception:
        return None

    try:
        with Image.open(BytesIO(raw)) as img:
            # bomb:`Image.open` lazy,read-only
            # header; 60MP convert/resize.
            # hard gate (/
            # failure), None --
            # base64 gate .
            if img.width * img.height > _MAX_DECODE_PIXELS:
                logger.warning(
                    "Refusing to decode oversized image (%dx%d) for resize; keeping original bytes",
                    img.width,
                    img.height,
                )
                return None
            # ( GIF/WebP/APNG) resize: ``convert("RGB")`` + ``save(JPEG)``
            # , ., None.
            if _is_animated_image(img):
                logger.warning(
                    "Skipping resize of animated image (%s, %dx%d); keeping original to avoid flattening it to a single frame",
                    img.format or mime_type,
                    img.width,
                    img.height,
                )
                return None
            target = area_capped_dimensions(img.width, img.height, DEFAULT_IMAGE_MAX_PIXELS)
            if target is None:
                return None
            resized = img.convert("RGB").resize(target, Image.Resampling.LANCZOS)
            buffer = BytesIO()
            resized.save(buffer, format="JPEG", quality=85)
    except Exception:
        # graceful: read_visual_file " fail" --
        # /exception, history failure.
        logger.warning("In-memory image resize failed; keeping original image", exc_info=True)
        return None

    return base64.b64encode(buffer.getvalue()).decode("utf-8"), "image/jpeg"


class OversizedInboundImageError(ValueError):
    """User-supplied inbound image exceeds the hard limits - rejected at entry.

     fail-fast(#601):error, retry;
    history  omit . 
    """


def ensure_inbound_images_within_limits(messages: Sequence[object]) -> None:
    """Reject user-supplied messages whose inline images exceed the hard limits.

     omit gate (``image_exceeds_hard_limit``:base64 
    20MiB, header/Pillow  >60MP).:
    ****,****.  USER   --  
,. 
    """
    from nexau.core.messages import ImageBlock, Message, Role

    for message_index, message in enumerate(messages):
        if not isinstance(message, Message) or message.role != Role.USER:
            continue
        for block_index, block in enumerate(message.content):
            if not isinstance(block, ImageBlock) or not block.base64:
                continue
            if image_exceeds_hard_limit(block.base64):
                approx_bytes = len(block.base64) * 3 // 4
                raise OversizedInboundImageError(
                    f"Inbound image (message #{message_index + 1}, block #{block_index + 1}) "
                    f"exceeds the hard limits (~{approx_bytes} bytes decoded; limits: "
                    f"20MiB bytes / 60MP pixels). Compress or downscale the image before "
                    f"sending — oversized originals are rejected at entry instead of being "
                    f"silently omitted downstream."
                )