export const rtcConfig: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

export async function createPeerConnection() {
  const pc = new RTCPeerConnection(rtcConfig);
  
  // Local stream handling
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: 320, height: 240 },
    audio: true
  });
  
  stream.getTracks().forEach(track => pc.addTrack(track, stream));

  return { pc, localStream: stream };
}
