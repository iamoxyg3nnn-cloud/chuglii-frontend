/**
 * Minimal MPEG-TS → H.264 SPS parser: extracts video resolution from the
 * first bytes of a TS segment without ffmpeg (serverless-safe).
 *
 * Proper demux path: TS packets → PAT → PMT → video PID (stream_type 0x1b)
 * → PES reassembly → ES byte stream → NAL start-code scan → first SPS
 * (type 7) → Exp-Golomb decode.
 * Only needs the first ~64-256 KB of a segment; callers decrypt with
 * autoPadding disabled so a truncated tail is fine.
 */

export interface VideoResolution {
  width: number;
  height: number;
}

const TS_PACKET = 188;

/** Bit reader over a byte buffer (MSB-first). */
class BitReader {
  private pos = 0;
  private readonly buf: Buffer;
  constructor(buf: Buffer) {
    this.buf = buf;
  }

  bit(): number {
    if (this.pos >= this.buf.length * 8) throw new Error("EOF");
    const byte = this.buf[this.pos >> 3]!;
    const bit = (byte >> (7 - (this.pos & 7))) & 1;
    this.pos += 1;
    return bit;
  }

  bits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.bit();
    return v;
  }

  /** Unsigned Exp-Golomb. */
  ue(): number {
    let zeros = 0;
    while (this.bit() === 0) {
      zeros += 1;
      if (zeros > 32) throw new Error("bad exp-golomb");
    }
    return zeros === 0 ? 0 : (1 << zeros) - 1 + this.bits(zeros);
  }

  /** Signed Exp-Golomb (se(v)). */
  se(): number {
    const v = this.ue();
    return v % 2 === 1 ? (v + 1) / 2 : -(v / 2);
  }
}

/** Remove emulation-prevention bytes (00 00 03 -> 00 00). */
function unescapeRbsp(nal: Buffer): Buffer {
  const out: number[] = [];
  for (let i = 0; i < nal.length; i++) {
    if (
      i >= 2 &&
      out[out.length - 1] === 0 &&
      out[out.length - 2] === 0 &&
      nal[i] === 3 &&
      (i + 1 >= nal.length || nal[i + 1]! <= 3)
    ) {
      continue; // emulation prevention byte
    }
    out.push(nal[i]!);
  }
  return Buffer.from(out);
}

function skipScalingList(r: BitReader, size: number): void {
  let lastScale = 8;
  let nextScale = 8;
  for (let j = 0; j < size; j++) {
    if (nextScale !== 0) {
      const deltaScale = r.se();
      nextScale = (lastScale + deltaScale + 256) % 256;
    }
    if (nextScale !== 0) lastScale = nextScale;
  }
}

/** Parse width/height out of an SPS NAL payload (without start code). */
export function parseSpsDimensions(spsRaw: Buffer): VideoResolution | null {
  try {
    const sps = unescapeRbsp(spsRaw);
    const r = new BitReader(sps);
    const profileIdc = r.bits(8);
    r.bits(8); // constraint flags + reserved
    r.bits(8); // level_idc
    r.ue(); // seq_parameter_set_id

    const highProfiles = new Set([
      100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135,
    ]);
    if (highProfiles.has(profileIdc)) {
      const chromaFormatIdc = r.ue();
      if (chromaFormatIdc === 3) r.bit(); // separate_colour_plane_flag
      r.ue(); // bit_depth_luma_minus8
      r.ue(); // bit_depth_chroma_minus8
      r.bit(); // qpprime_y_zero_transform_bypass_flag
      if (r.bit()) {
        // seq_scaling_matrix_present_flag
        const listCount = chromaFormatIdc !== 3 ? 8 : 12;
        for (let i = 0; i < listCount; i++) {
          if (r.bit()) skipScalingList(r, i < 6 ? 16 : 64);
        }
      }
    }

    r.ue(); // log2_max_frame_num_minus4
    const pocType = r.ue();
    if (pocType === 0) {
      r.ue(); // log2_max_pic_order_cnt_lsb_minus4
    } else if (pocType === 1) {
      r.bit(); // delta_pic_order_always_zero_flag
      r.se(); // offset_for_non_ref_pic
      r.se(); // offset_for_top_to_bottom_field
      const count = r.ue();
      for (let i = 0; i < count; i++) r.se(); // offset_for_ref_frame[]
    }

    r.ue(); // max_num_ref_frames
    r.bit(); // gaps_in_frame_num_value_allowed_flag
    const picWidthInMbs = r.ue() + 1;
    const picHeightInMapUnits = r.ue() + 1;
    const frameMbsOnly = r.bit();
    if (!frameMbsOnly) r.bit(); // mb_adaptive_frame_field_flag
    r.bit(); // direct_8x8_inference_flag

    let width = picWidthInMbs * 16;
    let height = picHeightInMapUnits * 16 * (frameMbsOnly ? 1 : 2);
    if (r.bit()) {
      // frame_cropping_flag
      const cropL = r.ue();
      const cropR = r.ue();
      const cropT = r.ue();
      const cropB = r.ue();
      const cropUnitX = 2; // 4:2:0 luma
      const cropUnitY = cropUnitX * (frameMbsOnly ? 1 : 2);
      width -= (cropL + cropR) * cropUnitX;
      height -= (cropT + cropB) * cropUnitY;
    }
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  } catch {
    return null;
  }
}

// ─── TS demux helpers ───────────────────────────────────────────────────────

interface TsPacket {
  pid: number;
  pusi: boolean; // payload_unit_start_indicator
  payload: Buffer | null;
}

function* iterTsPackets(data: Buffer): Generator<TsPacket> {
  const count = Math.floor(data.length / TS_PACKET);
  for (let p = 0; p < count; p++) {
    const off = p * TS_PACKET;
    if (data[off] !== 0x47) continue; // sync
    const pid = ((data[off + 1]! & 0x1f) << 8) | data[off + 2]!;
    const pusi = (data[off + 1]! & 0x40) !== 0;
    const afc = (data[off + 3]! >> 4) & 0x03;
    let payload: Buffer | null = null;
    if (afc === 1 || afc === 3) {
      const start = afc === 3 ? 5 + data[off + 4]! : 4;
      if (start < TS_PACKET) payload = data.subarray(off + start, off + TS_PACKET);
    }
    yield { pid, pusi, payload };
  }
}

/** Extract the elementary stream for the H.264 PID from a TS byte stream. */
function extractH264Es(data: Buffer): Buffer | null {
  // Pass 1: PAT (PID 0x0000) -> first program's PMT PID.
  let pmtPid: number | null = null;
  for (const pkt of iterTsPackets(data)) {
    if (pkt.pid !== 0x0000 || !pkt.payload || !pkt.pusi) continue;
    const sec = pkt.payload;
    const pointer = sec[0]!;
    const table = sec.subarray(1 + pointer);
    if (table[0] !== 0x00) break; // not a PAT
    const sectionLength = ((table[1]! & 0x0f) << 8) | table[2]!;
    let pos = 8; // past header
    const end = Math.min(3 + sectionLength - 4, table.length);
    while (pos + 4 <= end) {
      const program = (table[pos]! << 8) | table[pos + 1]!;
      const pid = ((table[pos + 2]! & 0x1f) << 8) | table[pos + 3]!;
      if (program !== 0 && pid !== 0) {
        pmtPid = pid;
        break;
      }
      pos += 4;
    }
    if (pmtPid !== null) break;
  }
  if (pmtPid === null) return null;

  // Pass 2: PMT -> first H.264 elementary PID (stream_type 0x1b).
  let videoPid: number | null = null;
  for (const pkt of iterTsPackets(data)) {
    if (pkt.pid !== pmtPid || !pkt.payload || !pkt.pusi) continue;
    const sec = pkt.payload;
    const pointer = sec[0]!;
    const table = sec.subarray(1 + pointer);
    if (table[0] !== 0x02) break; // not a PMT
    const sectionLength = ((table[1]! & 0x0f) << 8) | table[2]!;
    const programInfoLength = ((table[10]! & 0x0f) << 8) | table[11]!;
    let pos = 12 + programInfoLength;
    const end = Math.min(3 + sectionLength - 4, table.length);
    while (pos + 5 <= end) {
      const streamType = table[pos]!;
      const esPid = ((table[pos + 1]! & 0x1f) << 8) | table[pos + 2]!;
      const esInfoLength = ((table[pos + 3]! & 0x0f) << 8) | table[pos + 4]!;
      if (streamType === 0x1b) {
        videoPid = esPid;
        break;
      }
      pos += 5 + esInfoLength;
    }
    if (videoPid !== null) break;
  }
  if (videoPid === null) return null;

  // Pass 3: reassemble PES packets for the video PID -> ES bytes.
  const esChunks: Buffer[] = [];
  let pes: Buffer | null = null;
  for (const pkt of iterTsPackets(data)) {
    if (pkt.pid !== videoPid || !pkt.payload) continue;
    if (pkt.pusi) {
      // flush previous PES
      if (pes && pes.length > 9) {
        const headerLen = pes[8]!;
        esChunks.push(pes.subarray(9 + headerLen));
      }
      pes = Buffer.from(pkt.payload);
    } else if (pes) {
      pes = Buffer.concat([pes, pkt.payload]);
    }
    if (esChunks.length > 0 && esChunks.reduce((n, c) => n + c.length, 0) > 1_000_000) break;
  }
  if (pes && pes.length > 9) {
    const headerLen = pes[8]!;
    if (9 + headerLen < pes.length) esChunks.push(pes.subarray(9 + headerLen));
  }
  if (esChunks.length === 0) return null;
  return Buffer.concat(esChunks);
}

/** Scan the H.264 ES for the first SPS NAL and return its dimensions. */
export function parseTsVideoResolution(data: Buffer): VideoResolution | null {
  const es = extractH264Es(data);
  if (!es) return null;
  const n = es.length;
  let i = 0;
  while (i < n - 4) {
    if (es[i] === 0 && es[i + 1] === 0 && es[i + 2] === 1) {
      const nalStart = i + 3;
      const type = es[nalStart]! & 0x1f;
      if (type === 7) {
        let j = nalStart + 1;
        while (j < n - 2) {
          if (es[j] === 0 && es[j + 1] === 0 && es[j + 2] === 1) break;
          j += 1;
        }
        // skip the NAL header byte (nalStart) — parseSpsDimensions expects
        // the SPS RBSP payload only.
        return parseSpsDimensions(es.subarray(nalStart + 1, Math.min(j, nalStart + 513)));
      }
      i = nalStart;
      continue;
    }
    i += 1;
  }
  return null;
}
