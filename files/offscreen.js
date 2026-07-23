// Plays a short two-tone chime using the Web Audio API.
// Runs inside an offscreen document because a MV3 service worker
// cannot play audio directly.

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === "playSound") {
    playChime();
  }
});

function playChime() {
  const ctx = new AudioContext();
  const notes = [880, 1108.73]; // A5, C#6
  const now = ctx.currentTime;

  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;

    const start = now + i * 0.15;
    const end = start + 0.35;

    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.35, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, end);

    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.05);
  });

  setTimeout(() => ctx.close(), 1200);
}
