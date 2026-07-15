#!/usr/bin/env python3
"""Assemble a Lanyard demo/clip video: scene webms + TTS -> captioned MP4.

Spec-driven: each video is a JSON file (see narration/*.json):
  { "name": ..., "tagline": <closing-card subtitle>, "segments": [{scene, text}, ...] }
The last segment must be "closing" (rendered card, no webm take).

Usage:
  python3 build-video.py <spec.json> <assetsDir> <outDir>
    <assetsDir>/takes/<scene>.webm   raw Playwright takes (record.mjs)
    <assetsDir>/audio-<name>/        narration mp3s (tts.mjs)
    <assetsDir>/work-<name>/         intermediate files
    <outDir>/<name>.mp4              final video

Homebrew ffmpeg lacks drawtext/libass, so all text (captions, closing card) is
pre-rendered to PNG by render-overlays.mjs (Playwright) and composited with the
overlay filter.
"""
import json, subprocess, os, sys, pathlib

HERE = os.path.dirname(os.path.abspath(__file__))
spec_path, assets, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
spec = json.load(open(spec_path))
NAME = spec['name']
TAKES = f'{assets}/takes'
AUDIO = f'{assets}/audio-{NAME}'
WORK = f'{assets}/work-{NAME}'
pathlib.Path(WORK).mkdir(parents=True, exist_ok=True)
pathlib.Path(outdir).mkdir(parents=True, exist_ok=True)

def dur(path):
    return float(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', path]).strip())

def run(args):
    r = subprocess.run(args, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode()[-1500:])

# pass 1: closing card (cues don't exist yet; caption strips come in pass 2)
run(['node', f'{HERE}/render-overlays.mjs', WORK, spec['tagline']])

scene_files, timings, t = [], [], 0.0
for s in spec['segments']:
    name = s['scene']
    a = f'{AUDIO}/{name}.mp3'
    adur = dur(a)
    out = f'{WORK}/{name}.mp4'
    if name == 'closing':
        d = adur + 1.8
        run(['ffmpeg', '-y', '-loop', '1', '-i', f'{WORK}/overlays/closing.png', '-i', a,
             '-af', 'adelay=600|600,apad', '-t', f'{d:.2f}', '-r', '30',
             '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', out])
    else:
        v = f'{TAKES}/{name}.webm'
        vdur = dur(v)
        # long takes get gently sped up so no scene drags past the narration
        if vdur > adur + 3.0:
            d = adur + 2.5
            vf = f'scale=1280:800,setpts=PTS*{d / vdur:.4f},fps=30'
        else:
            d = max(vdur, adur + 0.6)
            vf = f'scale=1280:800,fps=30,tpad=stop_mode=clone:stop_duration={max(0.0, d - vdur):.2f}'
        run(['ffmpeg', '-y', '-i', v, '-i', a, '-vf', vf, '-af', 'apad', '-t', f'{d:.2f}',
             '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', out])
    scene_files.append(out)
    timings.append((t, t + d, s['text']))
    t += d
    print(f'{name}: {d:.1f}s')

with open(f'{WORK}/list.txt', 'w') as f:
    for p in scene_files:
        f.write(f"file '{p}'\n")
run(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', f'{WORK}/list.txt', '-c', 'copy', f'{WORK}/full-nocap.mp4'])

def chunks(text):
    """Split narration into caption-sized pieces: em-dash breaks, then sentences."""
    parts = [p.strip() for p in text.split(' — ')]
    out = []
    for p in parts:
        while len(p) > 110:
            cut = p.rfind('. ', 0, 110)
            if cut < 30:
                break
            out.append(p[:cut + 1])
            p = p[cut + 2:]
        out.append(p)
    return [c for c in out if c]

# caption cues, proportional to text length within each scene (skip closing card)
cues = []
for start, end, text in timings[:-1]:
    parts = chunks(text)
    total = sum(len(p) for p in parts)
    cursor = start
    for p in parts:
        share = (end - start) * len(p) / total
        cues.append({'i': len(cues), 'start': round(cursor, 2), 'end': round(min(cursor + share, end) - 0.05, 2), 'text': p})
        cursor += share

json.dump(cues, open(f'{WORK}/cues.json', 'w'))
run(['node', f'{HERE}/render-overlays.mjs', WORK, spec['tagline']])  # pass 2: caption strips

inputs = ['-i', f'{WORK}/full-nocap.mp4']
for c in cues:
    inputs += ['-i', f"{WORK}/overlays/cue-{c['i']}.png"]
chain, prev = [], '[0:v]'
for n, c in enumerate(cues):
    label = f'[v{n}]' if n < len(cues) - 1 else '[vout]'
    chain.append(f"{prev}[{n + 1}:v]overlay=0:0:enable='between(t,{c['start']},{c['end']})'{label}")
    prev = f'[v{n}]'
run(['ffmpeg', '-y', *inputs, '-filter_complex', ';'.join(chain),
     '-map', '[vout]', '-map', '0:a',
     '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'copy',
     f'{outdir}/{NAME}.mp4'])

print(f'{NAME}: total {t:.1f}s -> {outdir}/{NAME}.mp4 '
      f'({os.path.getsize(f"{outdir}/{NAME}.mp4") // 1024} KB)')
