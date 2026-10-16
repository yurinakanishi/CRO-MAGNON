# 共通名簿に合わせたRyuichiさんの壁画（r38・2026-10-16）

「関わってくれた人たち」と壁画を同じ対象へ統合するユーザー指定に対応し、既存の壁画になかったRyuichi-typeRを追加した。洞窟の形状を変えず、深い西壁の空いていた区画へ顔料を投影する。

## 制作とファイル

Codex内蔵 `image_gen` を使用。最初に参照画像と既存壁画を `view_image` で確認し、壁画1枚と個別の動物差し替え用1枚を生成した。プロンプト全文は [壁画](prompt.txt) と [動物版](animals-prompt.txt)。CLI/APIの別経路や、コードでの描画・後からの人物合成は使用していない。

- [参照](reference-archived.jpg)：2026-09-22に取得・確認済みの画像をGit `2bc2bd8a^:public/title/avatar-ryuichi.jpg` から制作資料へコピー。SHA `06cba8b57b036a3d1551a74c6be9748271ebdd702402dbf71f6adbfe9cbcc2e5` を既存記録と照合した。人物一覧のプロフィール画像は復活させていない。
- 画風の参照は既存 `public/models/camp-cave/daredaro-lascaux-r37.png`。
- [生成原本](generated.png)：2172×724、RGBA、2,229,175 bytes、SHA `998f00a40aa857c3ed4f453b62d2b7b712cfc122e341f360f82c348561609698`。
- [配信原本](paint.png)：全体をsharpのLanczos-3で1024×341へ縮小。494,217 bytes、SHA `2434d2899f1698b8ade9a66f5b2c488556ec0cb420b330e4d5c5e893f51fc553`。`public/models/camp-cave/ryuichi-lascaux-r38.png` へバイト単位でコピーした。
- [動物版の生成原本](animals-generated.png)と[1024版](animals.png)も保持。実際の差し替えは `../modular-r38/recipe.json` の人物領域内だけで行い、周囲の絵を保持する。表示中は生成された動物版を配信しない。
- [入力・出力のSHAと寸法](generation.json)、[変更前のマニフェスト](previous-asset.json)。採用処理は `scripts/adopt-cave-ryuichi-r38.mjs`。

生成PNGを目視してヘルメット・赤い帯・青い目・淡いジャケット、マンモス・馬・オーロックスの構図と透過を確認。生成編集した動物版は原画との画素一致を保証しないため、差し替えは小さい領域だけへ限定する。配信画像の四隅のアルファは0。

PCとスマホ相当の実Chromeで待機洞窟、PCでゲーム中の壁画を確認。参照・位置・画像と名簿の対応、レイ測定、関連235テスト、公開用ビルドの確認は [作業記録](../../../docs/contributor-cast-2026-10-16.md)。旧GLB・既存11画像と元のレシピは保持。実スマホ・Safari・物理パッド・性能比較は未検証。公開反映は未実施。
