# 約5万年前の地球を縮小したワールド

ユーザー指定の「当時の地球の大陸の形を保ち、遊べる広さに縮小」を扱う地理資料。広さはユーザーが選択した約4 km × 2 km（実装値 4,096 × 2,048 m）。モデルの新規生成・差し替えは行わず、採用済み31モデルの配信GLBを保持する。

## 基準時代と資料

- **50,000年前**：ネアンデルタール人の生存期間内にある時点を採用。最終氷期最盛期の21,000年前とは区別する。生存期間は [Smithsonian Human Origins](https://humanorigins.si.edu/evidence/human-fossils/species/homo-neanderthalensis) を参照。
- **海面 −68.3 m**：Spratt, R. M. & Lisiecki, L. E. (2016), *A Late Pleistocene sea level stack*, Climate of the Past 12, 1079–1092, [doi:10.5194/cp-12-1079-2016](https://cp.copernicus.org/articles/12/1079/2016/)。[NOAA収録データ](https://www.ncei.noaa.gov/pub/data/paleo/contributions_by_author/spratt2016/spratt2016-noaa.txt) の age_calkaBP = 50、SeaLev_shortPC1 列を使用。同じ行の95%区間は −84.91〜−58.55 m。資料DOIは [10.25921/rd66-5820](https://doi.org/10.25921/rd66-5820)。アクセス日2026-09-07。
- **海岸線の形**：NOAA NGDC ETOPO1の現代地形・海底地形を、NOAA AOML ERDDAPの `etopo180` から6分間隔で取得。元データは [ETOPO1 Global Relief Model](https://www.ncei.noaa.gov/products/etopo-global-relief-model)（Amante & Eakins, 2009, NOAA Technical Memorandum NESDIS NGDC-24, doi:10.7289/V5C8276M）。配信元の利用条件は `source/etopo1-metadata.txt` に保存。地理データの加工物であり、TRELLIS由来の可視メッシュそのものとは区別する。
- **氷床の解釈**：[Batchelor et al. (2019), *The configuration of Northern Hemisphere ice sheets through the Quaternary*](https://www.nature.com/articles/s41467-019-11601-2)、[Gowan et al. (2021), *A new global ice sheet reconstruction for the past 80,000 years*](https://www.nature.com/articles/s41467-021-21469-w) を参考に、北アメリカ・グリーンランド・スカンディナヴィアに氷床、北ユーラシアに雪原を配置。論文のGIS輪郭を抽出したものではない。氷床・雪・砂漠・火山帯の境界はゲーム向けに単純化した地域で、50 kaの正確な全球気候復元とは扱わない。

## 再現方法と限界

東西360度、南北180度を正距円筒図法で配置。縮尺は赤道上の東西距離で約1:9,784。高緯度での形や距離は投影による歪みがあり、地球上の全方向で同じ縮尺ではない。世界の左右端は有限の境界で、日付変更線を横断するラップ移動はない。人物・木・テント等の寸法は従来どおり。

ETOPO1を補間し、現代海面基準の標高が −68.3 mを上回る領域を陸地とする。氷床荷重による地殻変動、局地的な相対海面、堆積物、侵食、当時の湖水位、プレート運動は計算していない。したがって**約5万年前を想定した海岸線の近似**であり、考古学的な精密復元ではない。スンダ・サフル等の露出した大陸棚も同じ計算で現れる。2 mのゲーム用格子に収まらない小島や細い海峡は省略されることがある。

海岸の符号付き距離場を陸地の材質・海面エフェクト・地図・サーバー当たり判定で共有する。地表は既存TRELLIS GLBを32 m区画に配置し、海岸の面を材質で切り抜く。海面は既存 `river-water` GLBをタイル配置した水のシェーダー。可視プリミティブや読み込み時の代替モデルは追加しない。海岸の浅い上下調整は0.55 m以内。

遠方への「遠征」は指定された13野営地へのゲーム上の移動省略。ネアンデルタール人が全大陸や南極に居住していたという主張ではない。海上の歩行・泳ぎ・船・航海を追加するものでもない。

## 元データと再生成

`source/` の元NetCDF、海面テキスト、配信メタデータはそのまま保存。各SHA-256と取得URLは `source/manifest.json`。加工条件と距離場のSHA-256は `build.json`。

取得は `scripts/fetch-paleo-geography.mjs`、加工は `scripts/build-paleo-geography.py`。地理処理はnumpyのみを使い、GLBは書き換えない。実行に外部APIの有料サービスは不要。最終ゲーム用地理データは `shared/paleo-coast-data.mjs`、地形・気候・遠征座標は `shared/paleo-geography.mjs`。
