// WebRTC peer connection management
// SignalTransport interface + createPeerConnection()
// Offerer/answerer role determined by lexicographic UUID comparison (larger = offerer)

export interface SignalTransport {
  sendOffer(sdp: RTCSessionDescriptionInit): void;
  sendAnswer(sdp: RTCSessionDescriptionInit): void;
  sendIceCandidate(candidate: RTCIceCandidate): void;
  onOffer(callback: (sdp: RTCSessionDescriptionInit) => void): void;
  onAnswer(callback: (sdp: RTCSessionDescriptionInit) => void): void;
  onIceCandidate(callback: (candidate: RTCIceCandidate) => void): void;
  close(): void;
}
