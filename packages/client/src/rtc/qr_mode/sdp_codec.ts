// SDP binary codec for QR mode.
//
// Encodes a WebRTC SDP offer/answer into a compact binary packet (~78 bytes),
// and decodes it back to a valid SDP string that browsers accept.
//
// Binary packet format (version 0x02):
//   Byte 0:    Magic (0x4E = 'N' for notapipe)
//   Byte 1:    Version (0x02)
//   Byte 2:    Flags — bit 0: is_answer (0=offer, 1=answer)
//   Bytes 3-34: DTLS SHA-256 fingerprint (32 bytes)
//   Byte 35:   ufrag length (uint8)
//   Bytes 36+: ufrag (variable, typically 4 bytes)
//   Byte N:    pwd length (uint8)
//   Bytes N+1: pwd (variable, typically 22 bytes)
//   Byte M:    candidate count (uint8)
//   Bytes M+1: candidate entries (variable)
//   Byte P:    room_id length (uint8)
//   Bytes P+1: room_id (ASCII, e.g. "word-word-word")
//
// See docs/qr-mode.md for the full format specification.

const PACKET_MAGIC = 0x4e; // 'N'
const PACKET_VERSION = 0x02;

const FLAG_IS_ANSWER = 0b00000001;

// Candidate address type flags (bits 0-1 of candidate flag byte)
const ADDR_TYPE_IPV4 = 0b00;
const ADDR_TYPE_IPV6 = 0b01;
const ADDR_TYPE_MDNS = 0b10;

// Candidate type flag (bit 2 of candidate flag byte)
const CAND_TYPE_SRFLX = 0b100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DecodedCandidate {
  candidate_line: string; // full "candidate:..." string for SDP
}

interface DecodedPacket {
  is_answer: boolean;
  fingerprint_hex: string; // "AA:BB:CC:..." format
  ufrag: string;
  pwd: string;
  candidates: DecodedCandidate[];
  room_id: string;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Extract the DTLS fingerprint bytes from an SDP string.
 * Returns 32 bytes (SHA-256).
 */
function extractFingerprint(sdp: string): Uint8Array {
  const fingerprint_match = sdp.match(/a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/);
  if (fingerprint_match === null) {
    throw new Error("No SHA-256 fingerprint found in SDP");
  }
  const hex_pairs = fingerprint_match[1]!.split(":");
  const fingerprint_bytes = new Uint8Array(hex_pairs.length);
  hex_pairs.forEach((hex_pair, index) => {
    fingerprint_bytes[index] = parseInt(hex_pair, 16);
  });
  return fingerprint_bytes;
}

/**
 * Extract the ICE ufrag from an SDP string.
 */
function extractUfrag(sdp: string): string {
  const match = sdp.match(/a=ice-ufrag:(\S+)/);
  if (match === null) {
    throw new Error("No ice-ufrag found in SDP");
  }
  return match[1]!;
}

/**
 * Extract the ICE password from an SDP string.
 */
function extractPwd(sdp: string): string {
  const match = sdp.match(/a=ice-pwd:(\S+)/);
  if (match === null) {
    throw new Error("No ice-pwd found in SDP");
  }
  return match[1]!;
}

interface ParsedCandidate {
  ip_address: string;
  port: number;
  candidate_type: "host" | "srflx" | "relay" | "prflx";
  address_type: "ipv4" | "ipv6" | "mdns";
}

/**
 * Parse all ICE candidate lines from an SDP string.
 */
function parseCandidates(sdp: string): ParsedCandidate[] {
  const candidate_lines = sdp.match(/a=candidate:[^\r\n]+/g) ?? [];

  return candidate_lines.flatMap((line) => {
    // "candidate:foundation component protocol priority ip port typ type ..."
    const parts = line.replace("a=candidate:", "").split(" ");
    const ip_address = parts[4] ?? "";
    const port_str = parts[5] ?? "0";
    const candidate_type_str = parts[7] ?? "";
    const port = parseInt(port_str, 10);

    let candidate_type: ParsedCandidate["candidate_type"];
    switch (candidate_type_str) {
      case "host":
        candidate_type = "host";
        break;
      case "srflx":
        candidate_type = "srflx";
        break;
      case "relay":
        candidate_type = "relay";
        break;
      default:
        candidate_type = "prflx";
    }

    let address_type: ParsedCandidate["address_type"];
    if (ip_address.endsWith(".local")) {
      address_type = "mdns";
    } else if (ip_address.includes(":")) {
      address_type = "ipv6";
    } else {
      address_type = "ipv4";
    }

    return [{ ip_address, port, candidate_type, address_type }];
  });
}

/**
 * Select candidates for encoding per the filtering rules:
 * - At most 1 host IPv4
 * - At most 1 host IPv6
 * - At most 1 srflx IPv4
 * - At most 1 mDNS host
 * - Exclude relay candidates
 */
function filterCandidates(candidates: ParsedCandidate[]): ParsedCandidate[] {
  let has_host_ipv4 = false;
  let has_host_ipv6 = false;
  let has_srflx_ipv4 = false;
  let has_mdns = false;

  const selected: ParsedCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.candidate_type === "relay") {
      continue;
    }
    if (candidate.candidate_type === "host" && candidate.address_type === "ipv4" && !has_host_ipv4) {
      has_host_ipv4 = true;
      selected.push(candidate);
    } else if (candidate.candidate_type === "host" && candidate.address_type === "ipv6" && !has_host_ipv6) {
      has_host_ipv6 = true;
      selected.push(candidate);
    } else if (candidate.candidate_type === "srflx" && candidate.address_type === "ipv4" && !has_srflx_ipv4) {
      has_srflx_ipv4 = true;
      selected.push(candidate);
    } else if (candidate.address_type === "mdns" && !has_mdns) {
      has_mdns = true;
      selected.push(candidate);
    }
  }

  return selected;
}

/**
 * Encode a single IPv4 candidate into 7 bytes.
 */
function encodeIpv4Candidate(
  candidate: ParsedCandidate,
  view: DataView,
  offset: number,
): number {
  let flags = ADDR_TYPE_IPV4;
  if (candidate.candidate_type === "srflx") {
    flags |= CAND_TYPE_SRFLX;
  }
  view.setUint8(offset, flags);
  offset++;

  const octet_strings = candidate.ip_address.split(".");
  octet_strings.forEach((octet_str) => {
    view.setUint8(offset, parseInt(octet_str, 10));
    offset++;
  });

  view.setUint16(offset, candidate.port, false); // big-endian
  offset += 2;

  return offset;
}

/**
 * Encode a single IPv6 candidate into 19 bytes.
 */
function encodeIpv6Candidate(
  candidate: ParsedCandidate,
  view: DataView,
  offset: number,
): number {
  let flags = ADDR_TYPE_IPV6;
  if (candidate.candidate_type === "srflx") {
    flags |= CAND_TYPE_SRFLX;
  }
  view.setUint8(offset, flags);
  offset++;

  // Expand and write 16 bytes of IPv6 address
  const expanded_groups = expandIpv6(candidate.ip_address);
  expanded_groups.forEach((group_value) => {
    view.setUint16(offset, group_value, false);
    offset += 2;
  });

  view.setUint16(offset, candidate.port, false);
  offset += 2;

  return offset;
}

/**
 * Expand an IPv6 address string to 8 groups of uint16.
 */
function expandIpv6(ipv6: string): number[] {
  const halves = ipv6.split("::");
  const left_groups = halves[0] !== "" ? halves[0]!.split(":") : [];
  const right_groups = halves[1] !== undefined && halves[1] !== "" ? halves[1].split(":") : [];
  const total_groups = left_groups.length + right_groups.length;
  const zero_groups = 8 - total_groups;

  const all_groups = [
    ...left_groups,
    ...Array.from({ length: zero_groups }, () => "0"),
    ...right_groups,
  ];

  return all_groups.map((group) => parseInt(group, 16));
}

/**
 * Encode an mDNS candidate into 19 bytes.
 * The UUID hostname (e.g. "550e8400-e29b-41d4-a716-446655440000.local") is stored
 * as 16 raw bytes.
 */
function encodeMdnsCandidate(
  candidate: ParsedCandidate,
  view: DataView,
  offset: number,
): number {
  const flags = ADDR_TYPE_MDNS;
  view.setUint8(offset, flags);
  offset++;

  const uuid_string = candidate.ip_address.replace(".local", "").replace(/-/g, "");
  for (let byte_index = 0; byte_index < 16; byte_index++) {
    view.setUint8(offset, parseInt(uuid_string.slice(byte_index * 2, byte_index * 2 + 2), 16));
    offset++;
  }

  view.setUint16(offset, candidate.port, false);
  offset += 2;

  return offset;
}

/**
 * Encode an SDP string into a compact binary packet.
 */
export function encodeSdp(sdp: string, is_answer: boolean, room_id: string): Uint8Array {
  const fingerprint_bytes = extractFingerprint(sdp);
  const ufrag = extractUfrag(sdp);
  const pwd = extractPwd(sdp);
  const all_candidates = parseCandidates(sdp);
  const selected_candidates = filterCandidates(all_candidates);

  const encoder = new TextEncoder();
  const ufrag_bytes = encoder.encode(ufrag);
  const pwd_bytes = encoder.encode(pwd);
  const room_id_bytes = encoder.encode(room_id);

  // Calculate total byte size
  let total_bytes = 3; // magic + version + flags
  total_bytes += 32; // fingerprint
  total_bytes += 1 + ufrag_bytes.length; // ufrag length + ufrag
  total_bytes += 1 + pwd_bytes.length; // pwd length + pwd
  total_bytes += 1; // candidate count
  selected_candidates.forEach((candidate) => {
    if (candidate.address_type === "ipv4") {
      total_bytes += 7;
    } else {
      total_bytes += 19; // IPv6 or mDNS
    }
  });
  total_bytes += 1 + room_id_bytes.length; // room_id length + room_id

  const buffer = new ArrayBuffer(total_bytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  let offset = 0;

  view.setUint8(offset++, PACKET_MAGIC);
  view.setUint8(offset++, PACKET_VERSION);
  view.setUint8(offset++, is_answer ? FLAG_IS_ANSWER : 0);

  bytes.set(fingerprint_bytes, offset);
  offset += 32;

  view.setUint8(offset++, ufrag_bytes.length);
  bytes.set(ufrag_bytes, offset);
  offset += ufrag_bytes.length;

  view.setUint8(offset++, pwd_bytes.length);
  bytes.set(pwd_bytes, offset);
  offset += pwd_bytes.length;

  view.setUint8(offset++, selected_candidates.length);

  selected_candidates.forEach((candidate) => {
    if (candidate.address_type === "ipv4") {
      offset = encodeIpv4Candidate(candidate, view, offset);
    } else if (candidate.address_type === "ipv6") {
      offset = encodeIpv6Candidate(candidate, view, offset);
    } else {
      offset = encodeMdnsCandidate(candidate, view, offset);
    }
  });

  view.setUint8(offset++, room_id_bytes.length);
  bytes.set(room_id_bytes, offset);

  return bytes;
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode a binary packet back to its constituent parts.
 */
function decodePacket(packet: Uint8Array): DecodedPacket {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  let offset = 0;

  const magic = view.getUint8(offset++);
  if (magic !== PACKET_MAGIC) {
    throw new Error(`Invalid magic byte: 0x${magic.toString(16)}`);
  }

  const version = view.getUint8(offset++);
  if (version !== PACKET_VERSION) {
    throw new Error(`Unsupported packet version: ${version}`);
  }

  const flags = view.getUint8(offset++);
  const is_answer = (flags & FLAG_IS_ANSWER) !== 0;

  // Fingerprint — 32 bytes → "AA:BB:CC:..." hex string
  const fingerprint_hex = Array.from(packet.subarray(offset, offset + 32))
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(":");
  offset += 32;

  const ufrag_length = view.getUint8(offset++);
  const ufrag = new TextDecoder().decode(packet.subarray(offset, offset + ufrag_length));
  offset += ufrag_length;

  const pwd_length = view.getUint8(offset++);
  const pwd = new TextDecoder().decode(packet.subarray(offset, offset + pwd_length));
  offset += pwd_length;

  const candidate_count = view.getUint8(offset++);
  const candidates: DecodedCandidate[] = [];
  let foundation_index = 1;

  for (let candidate_number = 0; candidate_number < candidate_count; candidate_number++) {
    const candidate_flags = view.getUint8(offset++);
    const address_type = candidate_flags & 0b11;
    const is_srflx = (candidate_flags & CAND_TYPE_SRFLX) !== 0;
    const candidate_type_string = is_srflx ? "srflx" : "host";
    const priority = is_srflx ? 1686052607 : 2122252543;

    let ip_address: string;
    let port: number;

    if (address_type === ADDR_TYPE_IPV4) {
      const octet_a = view.getUint8(offset++);
      const octet_b = view.getUint8(offset++);
      const octet_c = view.getUint8(offset++);
      const octet_d = view.getUint8(offset++);
      ip_address = `${octet_a}.${octet_b}.${octet_c}.${octet_d}`;
      port = view.getUint16(offset, false);
      offset += 2;
    } else if (address_type === ADDR_TYPE_IPV6) {
      const groups: string[] = [];
      for (let group_index = 0; group_index < 8; group_index++) {
        groups.push(view.getUint16(offset, false).toString(16));
        offset += 2;
      }
      ip_address = groups.join(":");
      port = view.getUint16(offset, false);
      offset += 2;
    } else {
      // mDNS — 16 UUID bytes → "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.local"
      const uuid_bytes = Array.from(packet.subarray(offset, offset + 16));
      offset += 16;
      const hex_string = uuid_bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
      ip_address =
        `${hex_string.slice(0, 8)}-${hex_string.slice(8, 12)}-${hex_string.slice(12, 16)}-${hex_string.slice(16, 20)}-${hex_string.slice(20)}.local`;
      port = view.getUint16(offset, false);
      offset += 2;
    }

    const rel_addr_part = is_srflx ? ` raddr 0.0.0.0 rport 0` : "";
    const candidate_line = `candidate:${foundation_index} 1 UDP ${priority} ${ip_address} ${port} typ ${candidate_type_string}${rel_addr_part}`;
    candidates.push({ candidate_line });
    foundation_index++;
  }

  const room_id_length = view.getUint8(offset++);
  const room_id = new TextDecoder().decode(packet.subarray(offset, offset + room_id_length));

  return { is_answer, fingerprint_hex, ufrag, pwd, candidates, room_id };
}

// ---------------------------------------------------------------------------
// SDP Template Reconstruction
// ---------------------------------------------------------------------------

/**
 * Reconstruct a full SDP string from the decoded packet parts.
 */
function buildSdpFromParts(decoded: DecodedPacket): string {
  const setup = decoded.is_answer ? "active" : "actpass";
  const candidate_lines = decoded.candidates
    .map((c) => `a=${c.candidate_line}`)
    .join("\r\n");

  return [
    "v=0",
    "o=- 0 0 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "a=extmap-allow-mixed",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    `a=ice-ufrag:${decoded.ufrag}`,
    `a=ice-pwd:${decoded.pwd}`,
    `a=fingerprint:sha-256 ${decoded.fingerprint_hex}`,
    `a=setup:${setup}`,
    "a=mid:0",
    "a=sctp-port:5000",
    "a=max-message-size:262144",
    candidate_lines,
    "",
  ].join("\r\n");
}

/**
 * Decode a binary packet back into a full SDP string.
 */
export function decodeSdp(packet: Uint8Array): {
  sdp: string;
  type: "offer" | "answer";
  room_id: string;
} {
  const decoded = decodePacket(packet);
  const sdp = buildSdpFromParts(decoded);
  return { sdp, type: decoded.is_answer ? "answer" : "offer", room_id: decoded.room_id };
}

/**
 * Extract the room ID and packet type from a QR packet without full SDP reconstruction.
 * Used by the scanning peer to determine whether a room switch is needed.
 * Only offer packets carry an authoritative room ID — answer packets should be ignored
 * for room switching purposes.
 */
export function decodePacketMeta(packet: Uint8Array): { room_id: string; is_answer: boolean } {
  const decoded = decodePacket(packet);
  return { room_id: decoded.room_id, is_answer: decoded.is_answer };
}
