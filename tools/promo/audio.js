/* Builds the film's soundtrack as 48 kHz / 16-bit stereo WAV.
 *
 * The film is scored with "Azure Skies" (trxxshed / Philichordia / a l e x).
 * If that track is present in the local NetEase Cloud Music cache we decode it
 * (the .uc files are just XOR 0xA3) and cut a 43.6 s bed with fades. On a
 * machine without the cache we fall back to the original synthesiser below:
 * three detuned sine layers through a one-pole low-pass, plus a soft noise
 * swell on every scene change. No samples, no libraries either way.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const SR = 48000;
const DUR = 43.6;
const N = Math.round(SR * DUR);

/* ---------------------------------------------- real track (preferred path) */
const OUT = path.join(__dirname, '..', '..', '.tmp', 'promo', 'score.wav');

function fromLocalTrack() {
  const songId = '1849256862';        // Azure Skies — trxxshed
  const roots = [
    path.join(os.homedir(), 'AppData', 'Local', 'NetEase', 'CloudMusic', 'Cache', 'Cache'),
    path.join(os.homedir(), 'AppData', 'Local', 'Netease', 'CloudMusic', 'Cache', 'Cache')
  ];
  let uc = null;
  for (const dir of roots) {
    if (!fs.existsSync(dir)) continue;
    const hit = fs.readdirSync(dir).find(
      (f) => f.startsWith(`${songId}-`) && f.toLowerCase().endsWith('.uc')
    );
    if (hit) { uc = path.join(dir, hit); break; }
  }
  if (!uc) return false;

  const m4a = path.join(__dirname, '..', '..', '.tmp', 'promo', 'azure-skies.m4a');
  const raw = fs.readFileSync(uc);
  const dec = Buffer.allocUnsafe(raw.length);
  for (let i = 0; i < raw.length; i++) dec[i] = raw[i] ^ 0xA3;
  if (dec.slice(4, 8).toString('latin1') !== 'ftyp') return false;   // not audio
  fs.writeFileSync(m4a, dec);

  const local = path.join(__dirname, '..', '..', '.tmp', 'promo', 'ffmpeg');
  let exe = fs.existsSync(local) ? local : 'ffmpeg';
  // Node on Windows cannot CreateProcess a PE file that has no .exe suffix.
  // A hard link keeps the same bytes without duplicating the 78 MB binary.
  if (fs.existsSync(local) && !local.toLowerCase().endsWith('.exe')) {
    const link = `${local}.exe`;
    if (!fs.existsSync(link)) { try { fs.linkSync(local, link); } catch { /* fall back */ } }
    if (fs.existsSync(link)) exe = link;
  }
  const r = spawnSync(exe, [
    '-y', '-loglevel', 'error', '-i', m4a, '-t', String(DUR),
    '-af', `afade=t=in:st=0:d=0.9,afade=t=out:st=${(DUR - 3).toFixed(2)}:d=3,loudnorm=I=-18:TP=-2:LRA=11`,
    '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', OUT
  ], { windowsHide: true, encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(OUT)) {
    process.stderr.write(`[audio] ffmpeg failed (${r.status}): ${r.error ? r.error.message : ''} ${String(r.stderr || '').slice(0, 240)}\n`);
    return false;
  }
  console.log('wrote', OUT, '— Azure Skies (local cache)',
    (fs.statSync(OUT).size / 1024 / 1024).toFixed(1), 'MB');
  return true;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
if (fromLocalTrack()) process.exit(0);
console.log('Azure Skies not found locally — falling back to the synth score.');

const CUES = [0.35, 4.0, 8.4, 13.6, 17.2, 20.8, 24.0, 26.2, 29.2, 32.2, 35.2, 38.6];

const CHORDS = [
  { t: 0.0, f: [110.0, 164.81, 220.0] },     // A2 E3 A3  opening
  { t: 4.0, f: [130.81, 196.0, 261.63] },    // C3 G3 C4  now playing
  { t: 8.4, f: [98.0, 146.83, 196.0] },      // G2 D3 G3  AI
  { t: 13.6, f: [146.83, 220.0, 293.66] },   // D3 A3 D4  todo
  { t: 17.2, f: [164.81, 246.94, 329.63] },  // E3 B3 E4  handoff
  { t: 20.8, f: [110.0, 164.81, 246.94] },   // A2 E3 B3  themes
  { t: 24.0, f: [123.47, 185.0, 246.94] },   // B2 F#3 B3 eyes
  { t: 26.2, f: [87.31, 130.81, 174.61] },   // F2 C3 F3  system
  { t: 29.2, f: [98.0, 146.83, 220.0] },     // G2 D3 A3  storage
  { t: 32.2, f: [130.81, 196.0, 293.66] },   // C3 G3 D4  reminders
  { t: 35.2, f: [110.0, 164.81, 261.63] },   // A2 E3 C4  focus
  { t: 38.6, f: [130.81, 196.0, 329.63] }    // C3 G3 E4  resolve
];

const L = new Float32Array(N);
const R = new Float32Array(N);

/* crossfaded chord gain so a change never clicks */
function chordAt(i) {
  const t = i / SR;
  let cur = CHORDS[0];
  let prev = null;
  let mix = 1;
  for (let k = 0; k < CHORDS.length; k++) {
    if (t >= CHORDS[k].t) {
      cur = CHORDS[k];
      prev = k > 0 ? CHORDS[k - 1] : null;
      mix = Math.min(1, (t - cur.t) / 1.4);
    }
  }
  return { cur, prev, mix };
}

let lpL = 0;
let lpR = 0;
let seed = 1337;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296 * 2 - 1;
};

for (let i = 0; i < N; i++) {
  const t = i / SR;
  const { cur, prev, mix } = chordAt(i);

  // slow global swell: quiet at the very start, opens at the themes chapter,
  // closes again for the end card
  let env = 0.55 + 0.2 * Math.sin(t * 0.35);
  if (t < 1.2) env *= t / 1.2;
  if (t > DUR - 1.8) env *= Math.max(0, (DUR - 0.2 - t) / 1.8);

  let l = 0;
  let r = 0;
  for (let v = 0; v < 3; v++) {
    const fc = cur.f[v];
    const fp = prev ? prev.f[v] : fc;
    const det = 1 + (v - 1) * 0.0012;      // gentle chorus between voices
    const a = Math.sin(2 * Math.PI * fc * det * t) * (v === 0 ? 0.5 : 0.3);
    const b = prev ? Math.sin(2 * Math.PI * fp * det * t) * (v === 0 ? 0.5 : 0.3) : 0;
    const s = a * mix + b * (1 - mix);
    // a fifth above, very quiet, for air
    const air = Math.sin(2 * Math.PI * fc * 2.004 * t) * 0.035;
    l += s * (0.9 + Math.sin(t * 0.9 + v) * 0.1) + air;
    r += s * (0.9 + Math.cos(t * 0.8 + v * 1.7) * 0.1) + air;
  }

  // sub, only under the opening and the end card
  const sub = Math.sin(2 * Math.PI * 55 * t) * (t < 3 || t > 38 ? 0.09 : 0.045);
  l += sub;
  r += sub;

  // noise swells on scene changes
  let nz = 0;
  for (let c = 0; c < CUES.length; c++) {
    const d = t - CUES[c];
    if (d > -0.05 && d < 1.1) {
      const e = Math.exp(-d * 4.2) * Math.min(1, (d + 0.05) / 0.12) * 0.16;
      nz += rnd() * e;
    }
  }
  l += nz;
  r += nz * 0.82;

  // one-pole low pass, two passes = 12 dB/oct, kills the hiss of the noise
  const k = 0.24;
  lpL += (l - lpL) * k;
  lpR += (r - lpR) * k;
  L[i] = lpL;
  R[i] = lpR;
}

let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const gain = peak > 0 ? 0.72 / peak : 1;

const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + N * 4, 4);
buf.write('WAVEfmt ', 8);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(L[i] * gain * 32767))), 44 + i * 4);
  buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(R[i] * gain * 32767))), 46 + i * 4);
}

const out = path.join(__dirname, '..', '..', '.tmp', 'promo', 'score.wav');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buf);
console.log('wrote', out, (buf.length / 1024 / 1024).toFixed(1), 'MB');
