import { describe, it, expect } from "vitest";
import { encodeSdp, decodeSdp } from "../src/rtc/qr_mode/sdp_codec.ts";

// ---------------------------------------------------------------------------
// Realistic SDP samples (captured from Chrome with data channel only)
// ---------------------------------------------------------------------------

// SDP with 2 IPv4 candidates: 1 host, 1 srflx
const CHROME_OFFER_SDP = [
  "v=0",
  "o=- 8802127521370928270 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "a=extmap-allow-mixed",
  "a=msid-semantic: WMS",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=ice-ufrag:AbCd",
  "a=ice-pwd:AbCdEfGhIjKlMnOpQrStUv",
  "a=ice-options:trickle",
  "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
  "a=setup:actpass",
  "a=mid:0",
  "a=sctp-port:5000",
  "a=max-message-size:262144",
  "a=candidate:1 1 UDP 2122252543 192.168.1.5 54321 typ host",
  "a=candidate:2 1 UDP 1686052607 203.0.113.1 54321 typ srflx raddr 0.0.0.0 rport 0",
  "",
].join("\r\n");

// SDP answer (is_answer=true, setup=active)
const CHROME_ANSWER_SDP = [
  "v=0",
  "o=- 1234567890 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "a=extmap-allow-mixed",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=ice-ufrag:EfGh",
  "a=ice-pwd:EfGhIjKlMnOpQrStUvWxYzAb",
  "a=fingerprint:sha-256 11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00",
  "a=setup:active",
  "a=mid:0",
  "a=sctp-port:5000",
  "a=max-message-size:262144",
  "a=candidate:1 1 UDP 2122252543 10.0.0.2 12345 typ host",
  "",
].join("\r\n");

// SDP with IPv6 candidate
const IPV6_SDP = [
  "v=0",
  "o=- 1 1 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "a=extmap-allow-mixed",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=ice-ufrag:IjKl",
  "a=ice-pwd:IjKlMnOpQrStUvWxYzAbCdEf",
  "a=fingerprint:sha-256 FF:EE:DD:CC:BB:AA:99:88:77:66:55:44:33:22:11:00:FF:EE:DD:CC:BB:AA:99:88:77:66:55:44:33:22:11:00",
  "a=setup:actpass",
  "a=mid:0",
  "a=sctp-port:5000",
  "a=max-message-size:262144",
  "a=candidate:1 1 UDP 2122187007 2001:db8:85a3::8a2e:370:7334 55555 typ host",
  "",
].join("\r\n");

// SDP with mDNS candidate (Chromium privacy mode)
const MDNS_SDP = [
  "v=0",
  "o=- 1 1 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "a=extmap-allow-mixed",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=ice-ufrag:MnOp",
  "a=ice-pwd:MnOpQrStUvWxYzAbCdEfGhIj",
  "a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF",
  "a=setup:actpass",
  "a=mid:0",
  "a=sctp-port:5000",
  "a=max-message-size:262144",
  "a=candidate:1 1 UDP 2122252543 550e8400-e29b-41d4-a716-446655440000.local 44444 typ host",
  "",
].join("\r\n");

// ---------------------------------------------------------------------------
// Helper: extract key SDP fields for comparison
// ---------------------------------------------------------------------------

function extractSdpFields(sdp: string): {
  ufrag: string;
  pwd: string;
  fingerprint: string;
  candidate_count: number;
} {
  const ufrag = (sdp.match(/a=ice-ufrag:(\S+)/) ?? [])[1] ?? "";
  const pwd = (sdp.match(/a=ice-pwd:(\S+)/) ?? [])[1] ?? "";
  const fingerprint = (sdp.match(/a=fingerprint:sha-256 ([^\r\n]+)/) ?? [])[1] ?? "";
  const candidate_count = (sdp.match(/a=candidate:/g) ?? []).length;
  return { ufrag, pwd, fingerprint, candidate_count };
}

// ---------------------------------------------------------------------------
// Round-trip tests
// ---------------------------------------------------------------------------

describe("encodeSdp / decodeSdp round-trips", () => {
  it("round-trips a Chrome offer with IPv4 host + srflx candidates", () => {
    const packet = encodeSdp(CHROME_OFFER_SDP, false);
    const { sdp, type } = decodeSdp(packet);

    expect(type).toBe("offer");

    const original = extractSdpFields(CHROME_OFFER_SDP);
    const decoded = extractSdpFields(sdp);

    expect(decoded.ufrag).toBe(original.ufrag);
    expect(decoded.pwd).toBe(original.pwd);
    expect(decoded.fingerprint.toUpperCase()).toBe(original.fingerprint.toUpperCase());
    expect(decoded.candidate_count).toBe(2);
  });

  it("round-trips a Chrome answer (is_answer flag)", () => {
    const packet = encodeSdp(CHROME_ANSWER_SDP, true);
    const { sdp, type } = decodeSdp(packet);

    expect(type).toBe("answer");
    expect(sdp).toContain("a=setup:active");

    const original = extractSdpFields(CHROME_ANSWER_SDP);
    const decoded = extractSdpFields(sdp);
    expect(decoded.ufrag).toBe(original.ufrag);
    expect(decoded.pwd).toBe(original.pwd);
    expect(decoded.fingerprint.toUpperCase()).toBe(original.fingerprint.toUpperCase());
  });

  it("round-trips an SDP with an IPv6 host candidate", () => {
    const packet = encodeSdp(IPV6_SDP, false);
    const { sdp } = decodeSdp(packet);

    expect(sdp).toContain("2001:db8:85a3:0:0:8a2e:370:7334");
    expect(sdp).toContain("55555 typ host");

    const decoded = extractSdpFields(sdp);
    const original = extractSdpFields(IPV6_SDP);
    expect(decoded.ufrag).toBe(original.ufrag);
    expect(decoded.pwd).toBe(original.pwd);
  });

  it("round-trips an SDP with an mDNS candidate", () => {
    const packet = encodeSdp(MDNS_SDP, false);
    const { sdp } = decodeSdp(packet);

    expect(sdp).toContain("550e8400-e29b-41d4-a716-446655440000.local");
    expect(sdp).toContain("44444 typ host");

    const decoded = extractSdpFields(sdp);
    const original = extractSdpFields(MDNS_SDP);
    expect(decoded.ufrag).toBe(original.ufrag);
    expect(decoded.pwd).toBe(original.pwd);
  });
});

// ---------------------------------------------------------------------------
// Packet structure tests
// ---------------------------------------------------------------------------

describe("encodeSdp packet structure", () => {
  it("starts with the correct magic byte (0x4E)", () => {
    const packet = encodeSdp(CHROME_OFFER_SDP, false);
    expect(packet[0]).toBe(0x4e);
  });

  it("has version byte 0x01", () => {
    const packet = encodeSdp(CHROME_OFFER_SDP, false);
    expect(packet[1]).toBe(0x01);
  });

  it("sets the is_answer flag for answers", () => {
    const offer_packet = encodeSdp(CHROME_OFFER_SDP, false);
    const answer_packet = encodeSdp(CHROME_ANSWER_SDP, true);
    expect(offer_packet[2] & 0b1).toBe(0);
    expect(answer_packet[2] & 0b1).toBe(1);
  });

  it("produces a packet ≤ 100 bytes for a typical 2-candidate SDP", () => {
    const packet = encodeSdp(CHROME_OFFER_SDP, false);
    expect(packet.byteLength).toBeLessThanOrEqual(100);
  });

  it("produces the expected 78-byte packet for 2 IPv4 candidates", () => {
    // 3 (header) + 32 (fp) + 1 + 4 (ufrag) + 1 + 22 (pwd) + 1 + 7 + 7 (candidates) = 78
    const packet = encodeSdp(CHROME_OFFER_SDP, false);
    expect(packet.byteLength).toBe(78);
  });
});

// ---------------------------------------------------------------------------
// Candidate filtering tests
// ---------------------------------------------------------------------------

describe("candidate filtering", () => {
  it("excludes relay candidates", () => {
    const sdp_with_relay = CHROME_OFFER_SDP.replace(
      "a=candidate:2 1 UDP 1686052607 203.0.113.1 54321 typ srflx raddr 0.0.0.0 rport 0",
      "a=candidate:2 1 UDP 1686052607 203.0.113.1 54321 typ srflx raddr 0.0.0.0 rport 0\r\n" +
        "a=candidate:3 1 UDP 100 10.10.10.1 54321 typ relay raddr 0.0.0.0 rport 0",
    );
    const packet = encodeSdp(sdp_with_relay, false);
    const { sdp } = decodeSdp(packet);
    const candidate_count = (sdp.match(/a=candidate:/g) ?? []).length;
    expect(candidate_count).toBe(2); // host + srflx, no relay
  });

  it("limits to 1 host IPv4 candidate even if multiple are present", () => {
    const sdp_multi = CHROME_OFFER_SDP.replace(
      "a=candidate:1 1 UDP 2122252543 192.168.1.5 54321 typ host",
      "a=candidate:1 1 UDP 2122252543 192.168.1.5 54321 typ host\r\n" +
        "a=candidate:3 1 UDP 2122252543 192.168.1.6 54321 typ host",
    );
    const packet = encodeSdp(sdp_multi, false);
    const { sdp } = decodeSdp(packet);
    // Only 1 host IPv4 + 1 srflx = 2
    const candidate_count = (sdp.match(/a=candidate:/g) ?? []).length;
    expect(candidate_count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("decodeSdp error handling", () => {
  it("throws on wrong magic byte", () => {
    const packet = encodeSdp(CHROME_OFFER_SDP, false);
    const tampered = new Uint8Array(packet);
    tampered[0] = 0xff;
    expect(() => decodeSdp(tampered)).toThrow("Invalid magic byte");
  });

  it("throws on unsupported version", () => {
    const packet = encodeSdp(CHROME_OFFER_SDP, false);
    const tampered = new Uint8Array(packet);
    tampered[1] = 0x02;
    expect(() => decodeSdp(tampered)).toThrow("Unsupported packet version");
  });
});

// ---------------------------------------------------------------------------
// SDP template tests
// ---------------------------------------------------------------------------

describe("decoded SDP template", () => {
  it("contains all required SDP sections", () => {
    const packet = encodeSdp(CHROME_OFFER_SDP, false);
    const { sdp } = decodeSdp(packet);

    expect(sdp).toContain("v=0");
    expect(sdp).toContain("m=application 9 UDP/DTLS/SCTP webrtc-datachannel");
    expect(sdp).toContain("a=sctp-port:5000");
    expect(sdp).toContain("a=group:BUNDLE 0");
  });

  it("uses actpass setup for offers", () => {
    const packet = encodeSdp(CHROME_OFFER_SDP, false);
    const { sdp } = decodeSdp(packet);
    expect(sdp).toContain("a=setup:actpass");
  });

  it("uses active setup for answers", () => {
    const packet = encodeSdp(CHROME_ANSWER_SDP, true);
    const { sdp } = decodeSdp(packet);
    expect(sdp).toContain("a=setup:active");
  });
});
