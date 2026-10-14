#!/bin/sh
# cast_qa_renders.sh <work> <model.glb>: the Chrome renders (scripts/remake/chibi_views.mjs) of a chibi cast
# candidate for its review: three sides, the face, six poses, all ten clips at three phases from the front
# and the side (as JPEG sheets), and the adopted chibi woman beside it. Output: <work>/qa/.
set -e
cd "$(dirname "$0")/../.."
W=$1
G=$2
Q=$W/qa
rm -rf "$Q/final" "$Q/final-face" "$Q/final-poses" "$Q/woman-c5" "$Q/chain-front" "$Q/chain-side"
node scripts/remake/chibi_views.mjs "$G" "$Q/final" --frames whole --modes colour --views front,angle,rear --size 480 > /dev/null
node scripts/remake/chibi_views.mjs "$G" "$Q/final-face" --frames face --modes colour --views front,angle --face-centre .25 --face-span .32 --size 520 > /dev/null
node scripts/remake/chibi_views.mjs "$G" "$Q/final-poses" --frames whole --modes colour --views angle \
  --clips "Walk_Loop:0.3,Run_Loop:0.3,Attack:0.47,Eat:0.55,Wave:0.5,Gather:0.5" --size 400 > /dev/null
node scripts/remake/chibi_views.mjs public/models/cro-magnon-woman/model-c5-r01.glb "$Q/woman-c5" --frames whole --modes colour --views front --size 480 > /dev/null
C=""
for c in Idle_Loop Walk_Loop Run_Loop Gather Craft Give Eat Wave Attack Downed; do for p in 0.15 0.5 0.85; do C="$C,$c:$p"; done; done
C=${C#,}
node scripts/remake/chibi_views.mjs "$G" "$Q/chain-front" --frames whole --modes colour --views front --clips "$C" --size 300 --name poses-front > /dev/null
node scripts/remake/chibi_views.mjs "$G" "$Q/chain-side" --frames whole --modes colour --views side --clips "$C" --size 300 --name poses-side > /dev/null
python -c "
from PIL import Image
for d, n in [('chain-front', 'poses-front'), ('chain-side', 'poses-side')]:
    Image.open('$Q/' + d + '/' + n + '.png').convert('RGB').save('$Q/' + n + '.jpg', quality=88)
"
echo "QA_RENDERS_DONE $Q"
