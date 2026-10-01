The first imagegen reference had semi-transparent color glows around the character.
TRELLIS BiRefNet preprocessing incorrectly removed the red octopus flesh, retaining
only the human upper body. The cutout was visually rejected, and the started dense
generation was stopped before adoption. Keep reference-v1.png, prepared-01 cutout,
and dense-attempt-01 log as evidence; no resulting geometry may be adopted.

Next attempt: ask imagegen to remove only the background while preserving every red
tentacle, then use its alpha directly rather than segmenting the character again.

Reference-v2.png and TRELLIS auto alpha preprocessing preserved all tentacles;
prepared-02 was visually checked before dense attempt 02. Explicit BiRefNet was
the cause of the erroneous second segmentation. Prompt v3 was drafted as a white
background alternative but was not submitted because the retained alpha works.
