"""Validate and record the user-selected C2 surface 01 local turntable."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import math
import shutil
import subprocess

repo = Path(__file__).resolve().parents[3]
library = repo.parent / 'threed-model-creation'
root = library / 'models/rimo-neko'
spec_path = root / 'release/spec.json'
spec = json.loads(spec_path.read_text(encoding='utf-8'))
work = root / spec['work_directory']
manifest = json.loads((work / 'render-manifest.json').read_text(encoding='utf-8'))
frames = manifest['frames']
assert len(frames) == 300
for i, frame in enumerate(frames):
    assert frame['frame'] == i
    assert abs(frame['azimuth_degrees'] - (-30 + 1.2 * i)) < 1e-10
    assert abs(frame['actual_orbit']['theta'] - math.radians(frame['azimuth_degrees'])) < 1e-10
    assert abs(frame['actual_orbit']['phi'] - math.radians(80)) < 1e-10
    assert frame['actual_orbit']['radius'] == 1.6
    assert all(margin >= 12 for margin in [frame['bounds'][0], frame['bounds'][1], 959-frame['bounds'][2], 959-frame['bounds'][3]])

python = Path('C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe')
command = ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(library / 'tools/run_model_release.ps1'), '-Spec', str(spec_path), '-Python', str(python), '-Ffmpeg', 'ffmpeg', '-Ffprobe', 'ffprobe']
result = subprocess.run(command, check=True, capture_output=True, text=True, encoding='utf-8')
(work / 'canonical-validation.log').write_text(result.stdout + result.stderr, encoding='utf-8')

def digest(file):
    return hashlib.file_digest(file.open('rb'), 'sha256').hexdigest()

def record(file, **extra):
    return dict(path=file.relative_to(root).as_posix(), sha256=digest(file), bytes=file.stat().st_size, **extra)

packaging = json.loads((root / spec['packaging_report']).read_text(encoding='utf-8'))
stamp = datetime.now(timezone.utc)
outputs = []
for key in ['background', 'preview_image', 'rotation_contact_sheet']:
    outputs.append(record(root / spec[key], kind=key, width=960, height=960))
outputs.append(record(root / spec['rotation_video'], kind='rotation_video', codec='h264', width=960, height=960, frame_rate=30, frame_count=300, duration_seconds=10))
event = {
    'schema_version': 1,
    'recorded_at': stamp.isoformat(),
    'action': 'local_turntable_created',
    'user_selection': 'C2表面01いいね。モデルの全体が確認できる回転動画作って',
    'source_model': record(root / spec['source_glb']),
    'prepared_model': record(root / spec['prepared_glb']),
    'geometry_buffers_unchanged': packaging['mesh_buffers_unchanged'],
    'triangle_count': packaging['triangle_count'],
    'camera': {'canonical_front': '+Z in glTF; -Y in Blender', 'hero_side': 'negative-X front three-quarter', 'start_azimuth_degrees': -30, 'polar_degrees': 80, 'camera_distance_m': 1.6, 'field_of_view_degrees': 30, 'uniform_wrapper_scale': 1, 'pivot': 'full scene AABB center'},
    'generator': 'work/render-frames/c2-surface01-turntable-20261002-r02/turntable-c2-surface01.mjs',
    'renderer': manifest['renderer'],
    'trigger': 'Visible export button in a loopback browser page, operated through CUA',
    'encoder': 'ffmpeg -framerate 30 -i frame-%04d.jpg -frames:v 300 -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -movflags +faststart',
    'validation_command': 'tools/run_model_release.ps1 -Spec models/rimo-neko/release/spec.json (no publication flags)',
    'outputs': outputs,
    'minimum_frame_margin_px': min(min(f['bounds'][0],f['bounds'][1],959-f['bounds'][2],959-f['bounds'][3]) for f in frames),
    'rejected_capture_attempt': {'path': 'work/render-frames/c2-surface01-turntable-20261002', 'reason': 'model-viewer shared canvas capture failed full-frame margin check at frame 8; partial frames preserved and not encoded'},
    'publication': 'not_requested_not_performed',
    'game_model_change': False,
    'quality_scope': 'User selected surface 01 for a rotation review; no claim that rigging or game adoption is complete.',
}
history = root / 'release/history'
history.mkdir(exist_ok=True)
history_file = history / (stamp.strftime('%Y%m%dT%H%M%SZ') + '-c2-surface01-turntable.json')
with history_file.open('x', encoding='utf-8') as stream:
    json.dump(event, stream, ensure_ascii=False, indent=2)
    stream.write('\n')

validation_path = root / spec['records']['validation']
validation = json.loads(validation_path.read_text(encoding='utf-8'))
validation['local_turntable_review'] = {'history': history_file.relative_to(root).as_posix(), 'all_frames_fit': True, 'minimum_frame_margin_px': event['minimum_frame_margin_px'], 'user_selected_version': 'C2 surface 01', 'publication_performed': False}
validation_path.write_text(json.dumps(validation, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for name in ['turntable-c2-surface01.mjs', 'finish-turntable-c2-surface01.py']:
    shutil.copy2(Path(__file__).parent / name, work / name)

delivery = repo / 'output/rimo-neko-c2-surface01-turntable'
delivery.mkdir(parents=True, exist_ok=True)
for key in ['rotation_video', 'preview_image', 'rotation_contact_sheet']:
    source_file = root / spec[key]
    target = delivery / source_file.name
    shutil.copy2(source_file, target)
    assert digest(target) == digest(source_file)
(delivery / 'verification.json').write_text(json.dumps(event, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'video': str(delivery / Path(spec['rotation_video']).name), 'minimum_frame_margin_px': event['minimum_frame_margin_px'], 'history': str(history_file), 'video_sha256': outputs[-1]['sha256']}, ensure_ascii=False, indent=2))
