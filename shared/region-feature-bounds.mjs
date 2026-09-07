// Exact accepted GLB triangle footprints; measured by scripts/measure-region-feature.mjs.
export const REGION_FEATURE_BOUNDS = Object.freeze({
  "desert-cactus": {
    "key": "desert-cactus",
    "revision": "03",
    "sha256": "df3e780323fd45808d92b2f7edcd2c7d9ee8000f1ea0c67b29baab73c939d7ed",
    "source": "output/model-generation/models/desert-cactus/work/low-poly/candidate-03/candidate.glb",
    "method": "Every exact GLB triangle projected into XZ cells using separating axes; merged only across adjacent cells of equal conservative height.",
    "cellSize": 0.25,
    "maximumHorizontalOverestimateMetres": 0.3535533905932738,
    "bounds": {
      "min": [
        -0.26156508922576904,
        0.0003228260320611298,
        -0.618472695350647
      ],
      "max": [
        0.26193928718566895,
        2.4000654220581055,
        0.6181135177612305
      ]
    },
    "occupiedCells": 15,
    "boxes": [
      {
        "minX": -0.25,
        "maxX": 0.25,
        "minZ": -0.75,
        "maxZ": -0.5,
        "height": 2
      },
      {
        "minX": -0.25,
        "maxX": 0.25,
        "minZ": -0.5,
        "maxZ": -0.25,
        "height": 2
      },
      {
        "minX": -0.25,
        "maxX": 0.25,
        "minZ": -0.25,
        "maxZ": 0,
        "height": 2.5
      },
      {
        "minX": 0.25,
        "maxX": 0.5,
        "minZ": -0.25,
        "maxZ": 0,
        "height": 2
      },
      {
        "minX": -0.5,
        "maxX": -0.25,
        "minZ": 0,
        "maxZ": 0.25,
        "height": 1.75
      },
      {
        "minX": -0.25,
        "maxX": 0.25,
        "minZ": 0,
        "maxZ": 0.25,
        "height": 2.5
      },
      {
        "minX": 0.25,
        "maxX": 0.5,
        "minZ": 0,
        "maxZ": 0.25,
        "height": 2.25
      },
      {
        "minX": -0.25,
        "maxX": 0.25,
        "minZ": 0.25,
        "maxZ": 0.5,
        "height": 2.5
      },
      {
        "minX": -0.25,
        "maxX": 0.25,
        "minZ": 0.5,
        "maxZ": 0.75,
        "height": 2.5
      }
    ],
    "verification": {
      "surfaceSamples": 122175,
      "misses": 0
    },
    "limitations": "Conservative full silhouette collision; no under-arm passage or climbing physics."
  },
  "volcanic-basalt-columns": {
    "key": "volcanic-basalt-columns",
    "revision": "01",
    "sha256": "a3cf5fa909494f4250e4cacd9bc9529b9780f9d7292fc1bfd6bf6235ae71c0fc",
    "source": "output/model-generation/models/volcanic-basalt-columns/work/low-poly/candidate-01/candidate.glb",
    "method": "Every exact GLB triangle projected into XZ cells using separating axes; merged only across adjacent cells of equal conservative height.",
    "cellSize": 0.5,
    "maximumHorizontalOverestimateMetres": 0.7071067811865476,
    "bounds": {
      "min": [
        -1.9320671558380127,
        -0.0026331578847020864,
        -1.9733924865722656
      ],
      "max": [
        1.9274166822433472,
        4.599268913269043,
        1.9806773662567139
      ]
    },
    "occupiedCells": 58,
    "boxes": [
      {
        "minX": -1.5,
        "maxX": -1,
        "minZ": -2,
        "maxZ": -1.5,
        "height": 0.25
      },
      {
        "minX": -1,
        "maxX": -0.5,
        "minZ": -2,
        "maxZ": -1.5,
        "height": 1.75
      },
      {
        "minX": -0.5,
        "maxX": 0.5,
        "minZ": -2,
        "maxZ": -1.5,
        "height": 3
      },
      {
        "minX": 0.5,
        "maxX": 1.5,
        "minZ": -2,
        "maxZ": -1.5,
        "height": 0.5
      },
      {
        "minX": -1.5,
        "maxX": -0.5,
        "minZ": -1.5,
        "maxZ": -1,
        "height": 1.75
      },
      {
        "minX": -0.5,
        "maxX": 1,
        "minZ": -1.5,
        "maxZ": -1,
        "height": 3
      },
      {
        "minX": 1,
        "maxX": 1.5,
        "minZ": -1.5,
        "maxZ": -1,
        "height": 1.75
      },
      {
        "minX": 1.5,
        "maxX": 2,
        "minZ": -1.5,
        "maxZ": -1,
        "height": 0.25
      },
      {
        "minX": -2,
        "maxX": -1,
        "minZ": -1,
        "maxZ": -0.5,
        "height": 3
      },
      {
        "minX": -1,
        "maxX": 0.5,
        "minZ": -1,
        "maxZ": -0.5,
        "height": 4.75
      },
      {
        "minX": 0.5,
        "maxX": 1,
        "minZ": -1,
        "maxZ": -0.5,
        "height": 3
      },
      {
        "minX": 1,
        "maxX": 1.5,
        "minZ": -1,
        "maxZ": -0.5,
        "height": 2.25
      },
      {
        "minX": 1.5,
        "maxX": 2,
        "minZ": -1,
        "maxZ": -0.5,
        "height": 1.75
      },
      {
        "minX": -2,
        "maxX": -1,
        "minZ": -0.5,
        "maxZ": 0,
        "height": 3
      },
      {
        "minX": -1,
        "maxX": 0.5,
        "minZ": -0.5,
        "maxZ": 0,
        "height": 4.75
      },
      {
        "minX": 0.5,
        "maxX": 1,
        "minZ": -0.5,
        "maxZ": 0,
        "height": 4
      },
      {
        "minX": 1,
        "maxX": 1.5,
        "minZ": -0.5,
        "maxZ": 0,
        "height": 2.25
      },
      {
        "minX": 1.5,
        "maxX": 2,
        "minZ": -0.5,
        "maxZ": 0,
        "height": 1.75
      },
      {
        "minX": -2,
        "maxX": -1,
        "minZ": 0,
        "maxZ": 0.5,
        "height": 3
      },
      {
        "minX": -1,
        "maxX": 0.5,
        "minZ": 0,
        "maxZ": 0.5,
        "height": 4.75
      },
      {
        "minX": 0.5,
        "maxX": 1,
        "minZ": 0,
        "maxZ": 0.5,
        "height": 3.75
      },
      {
        "minX": 1,
        "maxX": 1.5,
        "minZ": 0,
        "maxZ": 0.5,
        "height": 3
      },
      {
        "minX": 1.5,
        "maxX": 2,
        "minZ": 0,
        "maxZ": 0.5,
        "height": 0.75
      },
      {
        "minX": -2,
        "maxX": -1,
        "minZ": 0.5,
        "maxZ": 1,
        "height": 1.75
      },
      {
        "minX": -1,
        "maxX": -0.5,
        "minZ": 0.5,
        "maxZ": 1,
        "height": 2.25
      },
      {
        "minX": -0.5,
        "maxX": 1,
        "minZ": 0.5,
        "maxZ": 1,
        "height": 3.75
      },
      {
        "minX": 1,
        "maxX": 1.5,
        "minZ": 0.5,
        "maxZ": 1,
        "height": 3
      },
      {
        "minX": 1.5,
        "maxX": 2,
        "minZ": 0.5,
        "maxZ": 1,
        "height": 0.75
      },
      {
        "minX": -2,
        "maxX": -1,
        "minZ": 1,
        "maxZ": 1.5,
        "height": 1.75
      },
      {
        "minX": -1,
        "maxX": 0,
        "minZ": 1,
        "maxZ": 1.5,
        "height": 2.25
      },
      {
        "minX": 0,
        "maxX": 1.5,
        "minZ": 1,
        "maxZ": 1.5,
        "height": 3
      },
      {
        "minX": 1.5,
        "maxX": 2,
        "minZ": 1,
        "maxZ": 1.5,
        "height": 0.75
      },
      {
        "minX": -1,
        "maxX": -0.5,
        "minZ": 1.5,
        "maxZ": 2,
        "height": 0.5
      },
      {
        "minX": -0.5,
        "maxX": 0.5,
        "minZ": 1.5,
        "maxZ": 2,
        "height": 1.75
      },
      {
        "minX": 0.5,
        "maxX": 1.5,
        "minZ": 1.5,
        "maxZ": 2,
        "height": 0.5
      }
    ],
    "verification": {
      "surfaceSamples": 311685,
      "misses": 0
    },
    "limitations": "Conservative full silhouette collision; no under-arm passage or climbing physics."
  }
});
