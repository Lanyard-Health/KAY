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

FADE = 0.35         # scenes dissolve to the constant paper background, never a hard cut
PAPER = '0xf4efe6'  # matches the frame.png field, so only the app card appears to fade

def paint_time(path):
    """Seconds until the page has actually painted (recording starts on a blank
    white frame while the SPA loads). First frame with any dark pixel = painted."""
    r = subprocess.run(
        ['ffmpeg', '-i', path, '-t', '4', '-vf',
         'signalstats,metadata=print:file=-:key=lavfi.signalstats.YMIN',
         '-f', 'null', '-'], capture_output=True)
    t = 0.0
    for line in r.stdout.decode(errors='ignore').splitlines():
        if 'pts_time:' in line:
            t = float(line.split('pts_time:')[1].split()[0])
        elif 'YMIN' in line and float(line.split('=')[1]) < 100:
            return t
    return 0.0

def fades(d):
    return (f',fade=t=in:st=0:d={FADE}:color={PAPER}'
            f',fade=t=out:st={d - FADE:.2f}:d={FADE}:color={PAPER}')

def run(args):
    r = subprocess.run(args, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode()[-1500:])

MAX_SPEED = 2.3     # never speed a take past this; trim it instead

def push(src_dur, out_size):
    """Slow Slack-style push-in: supersample, then zoompan on the 4K grid (subpixel-
    smooth), landing at 1.09x. out_size is the final scene size."""
    n = max(int(src_dur * 30), 1)
    return (f"fps=30,scale=3840:2160:flags=lanczos,"
            f"zoompan=z='1+0.09*in/{n}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'"
            f":d=1:s={out_size}:fps=30")

# cards.json before pass 1 so render-overlays can draw the section-title cards
cards = [{'scene': s['scene'], 'title': s['card']} for s in spec['segments'] if s.get('card')]
json.dump(cards, open(f'{WORK}/cards.json', 'w'))

# pass 1: closing + section cards + frame (cues don't exist yet; captions come in pass 2)
run(['node', f'{HERE}/render-overlays.mjs', WORK, spec['tagline']])

scene_files, timings, t = [], [], 0.0
for s in spec['segments']:
    name = s['scene']
    out = f'{WORK}/{name}.mp4'
    if s.get('card'):
        d = 2.4
        fc = f"[0:v]{push(d, '1920x1080')}{fades(d)}[v]"
        run(['ffmpeg', '-y', '-loop', '1', '-i', f'{WORK}/overlays/card-{name}.png',
             '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono',  # must match the TTS segments or concat -c copy corrupts timestamps
             '-filter_complex', fc, '-map', '[v]', '-map', '1:a', '-t', f'{d:.2f}',
             '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', out])
    elif name == 'closing':
        adur = dur(f'{AUDIO}/{name}.mp3')
        d = adur + 1.8
        run(['ffmpeg', '-y', '-loop', '1', '-i', f'{WORK}/overlays/closing.png', '-i', f'{AUDIO}/{name}.mp3',
             '-vf', f'null{fades(d)}',
             '-af', 'adelay=600|600,apad', '-t', f'{d:.2f}', '-r', '30',
             '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', out])
    else:
        adur = dur(f'{AUDIO}/{name}.mp3')
        v = f"{TAKES}/{s.get('take', name)}.webm"
        lead = paint_time(v)
        vdur = dur(v) - lead
        pre = f'trim=start={lead:.2f},setpts=PTS-STARTPTS,' if lead > 0 else ''
        # long takes get gently sped up so no scene drags past the narration
        if vdur > adur + 3.0:
            d = adur + 2.5
            need = d * MAX_SPEED
            if vdur > need:  # cap the speedup by trimming (tail: keep the end instead)
                start = (vdur - need + lead) if s.get('tail') else lead
                pre = f'trim=start={start:.2f},setpts=PTS-STARTPTS,trim=duration={need:.2f},setpts=PTS-STARTPTS,'
                vdur = need
            vf = f'{pre}{push(vdur, "1600x900")},setpts=PTS*{d / vdur:.4f}'
        else:
            d = max(vdur, adur + 0.6)
            vf = f'{pre}{push(vdur, "1600x900")},tpad=stop_mode=clone:stop_duration={max(0.0, d - vdur):.2f}'
        # take -> floating card on the paper field (frame.png supplies rounded corners + shadow)
        fc = (f'[0:v]{vf},pad=1920:1080:160:44:color={PAPER}[b];'
              f'[b][2:v]overlay=0:0{fades(d)}[v]')
        run(['ffmpeg', '-y', '-i', v, '-i', f'{AUDIO}/{name}.mp3', '-i', f'{WORK}/overlays/frame.png',
             '-filter_complex', fc, '-map', '[v]', '-map', '1:a',
             '-af', 'apad', '-t', f'{d:.2f}',
             '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', out])
    scene_files.append(out)
    timings.append((t, t + d, s.get('text')))
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

# caption cues, proportional to text length within each scene (skip cards + closing)
cues = []
for start, end, text in timings[:-1]:
    if not text:
        continue
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

# music bed: mixed under the narration with sidechain ducking, fading out at the end
music = f'{assets}/music.mp3'
if os.path.exists(music):
    m = 1 + len(cues)
    inputs += ['-stream_loop', '-1', '-i', music]
    chain.append(
        f'[0:a]asplit=2[voice][key];'
        f'[{m}:a]volume=0.16,afade=t=in:d=1.5[bg0];'
        f'[bg0][key]sidechaincompress=threshold=0.02:ratio=12:attack=150:release=600[bgd];'
        f'[voice][bgd]amix=inputs=2:duration=first:normalize=0,afade=t=out:st={t - 2.5:.2f}:d=2.5[aout]')
    amap, acodec = ['-map', '[aout]'], ['-c:a', 'aac']
else:
    amap, acodec = ['-map', '0:a'], ['-c:a', 'copy']

run(['ffmpeg', '-y', *inputs, '-filter_complex', ';'.join(chain),
     '-map', '[vout]', *amap, '-t', f'{t:.2f}',
     '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', *acodec,
     f'{outdir}/{NAME}.mp4'])

print(f'{NAME}: total {t:.1f}s -> {outdir}/{NAME}.mp4 '
      f'({os.path.getsize(f"{outdir}/{NAME}.mp4") // 1024} KB)')
