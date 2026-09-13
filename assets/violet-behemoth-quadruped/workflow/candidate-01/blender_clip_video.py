"""Render one MP4 per action from the exact bytes of the candidate GLB.

The scene fps is set to 30 before the glTF import so Blender maps the exported
action seconds onto whole frames. Looping clips render the half-open range, so the
duplicate terminal frame is omitted; single actions keep their final frame because
it is a distinct pose, and both frame counts are recorded.
"""
import hashlib
import json
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from blender_clip_sheet import (CAMERAS, argv_after_dashes, assign_action,  # noqa: E402
                                frame_bounds, parse_args, setup)

LOOPING = ('Idle_Loop', 'Walk_Loop', 'Run_Loop')
ORDER = ('Idle_Loop', 'Walk_Loop', 'Run_Loop', 'Gather', 'Craft', 'Give', 'Eat', 'Wave')


def configure_video(scene, quality='HIGH'):
    scene.render.image_settings.media_type = 'VIDEO'
    scene.render.image_settings.file_format = 'FFMPEG'
    scene.render.ffmpeg.format = 'MPEG4'
    scene.render.ffmpeg.codec = 'H264'
    scene.render.ffmpeg.constant_rate_factor = quality
    scene.render.ffmpeg.ffmpeg_preset = 'GOOD'
    scene.render.ffmpeg.gopsize = 15
    scene.render.ffmpeg.audio_codec = 'NONE'
    scene.render.use_file_extension = False


def main():
    args = parse_args(argv_after_dashes())
    glb = Path(args['glb']).resolve()
    outdir = Path(args['outdir']).resolve()
    outdir.mkdir(parents=True, exist_ok=True)
    view = args.get('view', 'threequarter')
    width = int(args.get('width', 720))
    height = int(args.get('height', 900))
    rig, mesh = setup(glb, width, height, CAMERAS[view])
    scene = bpy.context.scene
    scene.render.fps = 30
    scene.render.fps_base = 1.0
    configure_video(scene)

    digest = hashlib.sha256(glb.read_bytes()).hexdigest()
    actions = dict((action.name, action) for action in bpy.data.actions)
    manifest = []
    for name in ORDER:
        action = actions[name]
        assign_action(rig, action)
        start, end = frame_bounds(action)
        loop = name in LOOPING
        last = end - 1 if loop else end
        scene.frame_start = start
        scene.frame_end = last
        target = outdir / (name + '.mp4')
        scene.render.filepath = str(target)
        bpy.ops.render.render(animation=True)
        frames = last - start + 1
        manifest.append(dict(
            clip=name, loop=loop, file=target.name,
            authored_frame_range=[start, end], rendered_frame_range=[start, last],
            frames=frames, fps=30,
            authored_duration_seconds=round((end - start) / 30.0, 6),
            encoded_duration_seconds=round(frames / 30.0, 6),
            terminal_frame_omitted=loop,
            terminal_frame_note=('duplicate loop endpoint omitted' if loop else
                                 'single action keeps its final frame'),
            dimensions=[width, height], view=view,
            bytes=target.stat().st_size if target.is_file() else None,
            sha256=(hashlib.sha256(target.read_bytes()).hexdigest()
                    if target.is_file() else None)))
        rig.animation_data.action = None
        print('RENDERED', target.name, frames, 'frames', flush=True)

    record = dict(source_glb=str(glb), source_glb_sha256=digest, fps=30,
                  renderer='Blender Cycles CPU 8 samples, H.264 in MPEG-4 via the bundled encoder',
                  camera=dict(view=view, **CAMERAS[view]), videos=manifest)
    path = outdir / 'animation-videos.json'
    path.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    print('WROTE', path)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
