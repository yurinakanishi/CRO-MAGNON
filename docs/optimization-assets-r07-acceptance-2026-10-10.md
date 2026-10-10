# 2026-10-10 r07：28素材のローカル組み込み判定

この記録はCodexが実GLB・比較画像・数値を独立確認し、既に許可されているローカル組み込みの対象を確定した時点の記録。公開、展示機配布、サーバー再起動、commit/pushを許可するものではない。採用後の実パッケージ・通常プレイ・初期読込は別の実行記録へ追記し、この判定ファイルは書き換えない。

- 元の採用：20261010-r06-a02、plan SHA db0c29cdc80a6cc9ce45080ccd7b6700f61cf5ccad9055d03c920b9a3b6d60bb
- 新しい候補：assets/optimized-runtime/20261010-r07、レシピ guarded-surface@1
- 候補manifest SHA：fe6f1c08c35264504d20b4f19a2994f185a682350bb272755a246e0662d95aef
- 保存後の検証report SHA：7bddcf86626c30e05e638f0d4cf7af51435a6c1e10cd867ae44d61f7dbc8ee83
- 個別画像・実Chrome／Windows WebKit・候補SHAの判定：output/optimization-audit-20261009/lowpoly-high-visual-review-r01.json（SHA 9a1f0d6331d957b5c7f55ef9e584b6109be74bf0d1f3be5347038344574dd70d）
- 元GLBから残す頂点属性、頭部の材質、骨格、アニメーション、画像と未変更部品を照合。新しい接合不整合や成分の分離・結合・消失を拒否。各動作33%/66%と静止で固定8mm p99／24mm最大の表面条件、全ファイルraw以下かつgzip6削減を満たす。
- ネイティブGLBでは全動作各5時点の残存頂点差0。Codexが4方向、該当する顔と各動作中間を比較。全角度・全フレーム・物理スマホは未検証。元モデルの既存の欠点を修復したとは扱わない。
- 黄色マスコットの既定／追加候補、三角形ロボット、地形・床・洞窟・山などの結合形状、現行採用グラフ外の素材は含めない。却下済みの初期人物と紫の巨獣の旧LODを復活させない。
- 三角形398,670→322,192、raw33,889,228→31,353,684B、gzip6 30,238,451→27,840,896B。本体28個の合計であり、ゲーム全体・初期転送全体の数値ではない。

| モデル | 三角形（前→後） | gzip6 B（前→後） | 採用候補SHA-256 |
| --- | ---: | ---: | --- |
| berry-cluster | 1172→1036 | 248509→244039 | 0b2979057196f2ef91aa96a4c30f4c016c7a1847136af5d0ee06cc60bd2a2f14 |
| cockle-shell | 1474→1140 | 222271→213385 | b6f88569775436506d40d845c3893cd5a044b3c7dc81473dee74733f2ac068f0 |
| cro-magnon-woman | 82869→72851 | 4829154→4461491 | f414686fe312f6e3d67855644dc0d3b79a1c942484e2a60b0c977e4af370fb2b |
| crow-brute-axe | 3457→2941 | 742283→726150 | 801a430cf6998928a833a70e850cf9d49af8514cbbb78ce0cd7f442fb8a8fe67 |
| crow-pontiff-crown | 2929→2415 | 797539→779422 | 6cd6301778b4126a3d798c0af38735c605a0bd3ae3af7b1f79e7fc3735f09fbd |
| crow-pontiff-crozier | 3494→2776 | 609958→589954 | 96a0a3ad418a5df8e9e70dccca2e2e44ed636419db78eb566d787fef43074610 |
| crow-prelate-glaive | 2949→2359 | 541519→523912 | 13c4b69fdad3e6c4ba9197e9a5fd450aafa0c014dc95e3d1d8d8c63bd14de407 |
| crow-soldier-spear | 2993→2363 | 503225→485210 | a2eaa91ce99c3457f72849a08f85bf8e28e753cd4ee9169dbab00019095b2b7a |
| desert-fennec-mage | 53151→43901 | 3836253→3466394 | 3a6ce65bf5d2c4ab9da606555fa3183fe5491139717d46dee651be5f4ff41616 |
| drying-rack | 11816→11154 | 929898→910086 | 0f8cbf2efb8c6c6e140b50157534cede23ecfb0c6d0b41179bee4a1303f1d4bc |
| dugout-canoe | 13998→7466 | 612945→462883 | a7fab0685e610bdb2b21a1fd05327f64dceae476761b5c4615372769605d9b2a |
| firewood-log | 2984→2622 | 545628→536242 | 918a0a8e4b0fa91138912ce3d35dac1efbcfa224f44d2f33e56c82c2d4a2247c |
| firewood-pile | 5907→5049 | 651466→630336 | 3bd4571d0a2975a6bcca8438a4e0cd87193cf20254e7bc3303015141785bf236 |
| flint-spear | 5679→3065 | 914776→860672 | 26577c4c03479da4246040201ac5574fc5cd91127b9c44e7a0389a37a4305391 |
| giant-ape | 58216→50670 | 4383367→4093838 | 4aabd7de9803082467b19f2709bfdd182cc652c9ae43416a3c8757e4b0953843 |
| kunoichi-katana | 5997→2097 | 268538→164762 | 624f6bbc73dc6fdeae4758fefe31113f2da6b982f62fcedba56f95a571429c35 |
| mammoth-meat | 2996→2192 | 567387→545837 | 0bd4fbb82d7c92e95d7d8299c7ea1bd103c44cde11fa75cad7f9bd837a930540 |
| neanderthal-woman | 78675→68553 | 4375015→4004347 | fabb21a67061a199d24efac0e6196a0477cba02d73eab259bb6810a70e6ecd8d |
| obsidian-blade | 1500→524 | 165284→137974 | 76f281876580c9d5be10ca33d709f6290bd64e1eefeb805bd3ba58ceb7095822 |
| obsidian-spear | 3995→1397 | 199388→132004 | 418e6cd8a2c744003b3be807be09844b50fb4cb67b2d264cded15e14ba8a324a |
| orb-bot-beret | 3914→2672 | 435321→404211 | 822ea8338b5d8c9091a8e2b3a2e799af76749f78332e7154543b43404fe3c167 |
| orb-bot-blue | 4000→1400 | 153747→97457 | b0e706f21eed20c849383b1d0342050f320a12ecd9fbe4cb66a15a648cb8e836 |
| orb-bot-green | 4000→1400 | 142131→85893 | 84eaabe0bc40a9850b82b56ea63809b7def006728d7cbf8fcf26104fdbcbd771 |
| orb-bot-orange | 2531→885 | 99109→63779 | bfd5e993edc3a174c1e6bdcbeddf44a5c8d296426b628e13e81af6791f0c4e5c |
| orb-bot-purple | 4000→1400 | 148831→92056 | 96892c56a05dbc1e288becde3b2cf06036475ba97f168566c2fc248da8379d35 |
| orb-bot-white | 4000→1400 | 148668→91103 | 01e43c87f62b8fd17b95bee23c3d7d3af2ad7d12d4ea80076e67f16abdc3a74d |
| rimo-neko | 27474→25590 | 3031994→2943551 | 5787091de92988bd62db552ad5519c80792438e49f3be06874e352a779a5798e |
| wooden-spear | 2500→874 | 134247→93908 | 71a3a7ecb4d2e570667c3b44f2a49d3b4647221de887f708fbca8188dd1838be |

全81素材の計算と採用しない理由、関連テスト・外観確認の経緯は [作業記録](optimization-assets-lowpoly-2026-10-10.md)。この段階の候補生成はOpus5.5・High・ローカルClaude Codeの既存first-partyサブスクリプションで実行し、Codexが実行・検証した。追加利用なし（isUsingOverage false）を確認。
