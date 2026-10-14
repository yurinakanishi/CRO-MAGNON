#!/bin/sh
# chibi_surface.sh: the low-poly textured surface of a chibi character from a blank-face TRELLIS-2 dense mesh
# (the steps of the 2026-10-13 Cro-Magnon woman candidate 5, docs/cro-magnon-woman-chibi-2026-10-13.md):
#   meshopt reduction (head kept denser) -> xatlas atlases (body 1024, head 2048 with a denser face) ->
#   Blender bakes from the dense mesh -> reference colours restored (body: CIELAB quantiles, head: hair class) ->
#   the painted face of the original reference projected onto the head -> head and body merged.
# Output: <work>/low-poly, <work>/colour, <work>/face/head, <work>/graft/merged.glb and merged.json.
#
# Env (all required unless a default is given):
#   W          the candidate work folder (repository-relative), e.g. output/model-generation/models/<key>/work/candidate-01
#   DENSE      the dense GLB (repository-relative)
#   REF        the original reference PNG (the painted face is projected from it)
#   MASK       the reference matte (white = subject) in reference pixels
#   REG        project_face registration PXM,CX,CY (reference pixels per metre, feet centre)
#   LANDMARKS  EYE_ROW,CHIN_ROW of the reference
#   CUT        dense-unit height of the head/body split (between the chin and the collar)
#   FACEBOX    X0:X1:Y0:Y1:Z0:Z1 dense-unit box of the face front (1.8x texels)
#   BODY_ROWS  Y0,Y1 reference rows of the body colours (collar to soles)
#   HEAD_ROWS  Y0,Y1 reference rows of the hair colours (top to chin)
#   GUARD_FREE ellipses (reference pixels) where the hair guard does not apply: the eyes
#   NAME       model name for the bakes; HEIGHT (default 1.45); BUDGET (default 7000); BOOST (default 1.6: the
#              head keeps that many times the triangles; a big hairdo takes most of them, then use less)
#   ELLIPSE    projection ellipse (default 1.339,1.386,-0.171,0.2 of the eye-chin distance)
#   HAIR_SAT   saturation ramp S0,S1 of the hair class (default 0.32,0.42; lower for a less saturated dark hair)
#   HEAD_MODE  class (default: only the hair moves to the reference hair) or quantile (every head colour, for a pelt
#              hood in another colour than the hair: the class would pull the hood toward the hair)
#   FACE_EXTRA more project_face.py arguments, e.g. '--flat-normals 1.0' (blank-face fill edges baked as shallow steps)
set -e
cd "$(dirname "$0")/../.."
: "${W:?}" "${DENSE:?}" "${REF:?}" "${MASK:?}" "${REG:?}" "${LANDMARKS:?}" "${CUT:?}" "${FACEBOX:?}" "${BODY_ROWS:?}" "${HEAD_ROWS:?}" "${GUARD_FREE:?}" "${NAME:?}"
HEIGHT=${HEIGHT:-1.45}
BUDGET=${BUDGET:-7000}
BOOST=${BOOST:-1.6}
ELLIPSE=${ELLIPSE:-1.339,1.386,-0.171,0.2}
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
X=output/asset-remake/.venv-xatlas/Scripts/python.exe
WW=$(cd "$W" && pwd -W)
DW=$(cd "$(dirname "$DENSE")" && pwd -W)/$(basename "$DENSE")
mkdir -p "$W/low-poly" "$W/colour" "$W/face" "$W/graft"
MESHOPT_BOOST=y:$CUT:$BOOST node scripts/remake/meshopt_reduce.mjs "$DENSE" "$W/low-poly/meshopt-$BUDGET.glb" $BUDGET .01 | cut -c1-200
$X scripts/remake/xatlas_unwrap.py "$W/low-poly/meshopt-$BUDGET.glb" "$W/low-poly/xatlas-body-1024.glb" --resolution 1024 --padding 4 --select y:$CUT:below | cut -c1-160
$X scripts/remake/xatlas_unwrap.py "$W/low-poly/meshopt-$BUDGET.glb" "$W/low-poly/xatlas-head-2048.glb" --resolution 2048 --padding 8 --select y:$CUT:above "--boost-box=$FACEBOX:1.8" | cut -c1-160
for part in body head; do
  if [ $part = body ]; then size=1024; else size=2048; fi
  rm -rf "$W/low-poly/bake-$part"
  "$B" -b --python scripts/remake/remake_process.py -- --dense "$DW" --low "$WW/low-poly/xatlas-$part-$size.glb" --rebake --keep-low-uv \
    --out "$WW/low-poly/bake-$part" --height $HEIGHT --measure z --budget $BUDGET --name $NAME --albedo $size --normal $size 2>&1 | grep -E "Error|Traceback" || true
  test -f "$W/low-poly/bake-$part/candidate.glb"
done
python scripts/remake/match_reference_colours.py "$W/low-poly/bake-body/candidate.glb" "$REF" "$W/colour/body.glb" --mask "$MASK" --rows $BODY_ROWS --mode quantile | tail -1 | cut -c1-200
python scripts/remake/match_reference_colours.py "$W/low-poly/bake-head/candidate.glb" "$REF" "$W/colour/head.glb" --mask "$MASK" --rows $HEAD_ROWS --mode ${HEAD_MODE:-class} --class hair --class-sat ${HAIR_SAT:-0.32,0.42} | tail -1 | cut -c1-200
rm -rf "$W/face/head"
python scripts/remake/project_face.py "$W/colour/head.glb" "$REF" "$W/face/head" --landmarks $LANDMARKS --mode replace --ellipse $ELLIPSE \
  --facing 0.05,0.3 --mask "$MASK" --hair-guard --guard-free "$GUARD_FREE" --guard-min-width 9 --tone-match --tone-strength 0.5 \
  --registration $REG --max-flow 0 --output-size 1024 $FACE_EXTRA 2>&1 | tail -1 | cut -c1-200
"$B" -b --python scripts/remake/merge_head.py -- --body "$WW/colour/body.glb" --head "$WW/face/head/face.glb" --out "$WW/graft/merged.glb" --no-tone 2>&1 | grep -E "Error|Traceback|MERGE" || true
test -f "$W/graft/merged.glb"
echo "SURFACE_DONE $W/graft/merged.glb"
