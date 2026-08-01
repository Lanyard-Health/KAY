/**
 * Generate narration audio for a video spec (OpenAI TTS, tts-1-hd / nova).
 * Usage: OPENAI_API_KEY=... node scripts/demo-video/tts.mjs <spec.json> <audioOutDir>
 * Skips segments whose mp3 already exists (delete the file to re-generate).
 */
import fs from 'node:fs';
import path from 'node:path';

const [spec, outDir] = process.argv.slice(2);
if (!spec || !outDir) throw new Error('usage: tts.mjs <spec.json> <audioOutDir>');
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
fs.mkdirSync(outDir, { recursive: true });

const { segments } = JSON.parse(fs.readFileSync(spec, 'utf8'));
for (const s of segments) {
  if (!s.text) { console.log(`skip (card, no narration): ${s.scene}`); continue; }
  const file = path.join(outDir, `${s.scene}.mp3`);
  if (fs.existsSync(file)) { console.log(`skip (exists): ${s.scene}`); continue; }
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'tts-1-hd', voice: 'nova', input: s.text, speed: 1.0 }),
  });
  if (!res.ok) throw new Error(`TTS ${s.scene}: ${res.status} ${await res.text()}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`tts done: ${s.scene}`);
}
