# vendor/three

three.js r185 のうち、この街が実際に import する 13 本だけ。

**なぜ node_modules ではなく、ここに置くか。**
index.html の importmap が `./node_modules/three/…` を指していたが、
node_modules は追跡していないので、静的ホスト(Vercel)に上げると
404 になり、three が読めず **画面が黒いまま** になる。
ビルド手順を足したくないので、必要な分だけを取り込んで自己完結させた。

構成は node_modules と同じ相対配置。addons 内の相対 import
(Pass.js / CopyShader.js など)がそのまま解決される。

更新するとき:
  node_modules を新しい three にしてから、
  src/*.js が import している three/addons/* を辿って同じ 13 本を上書きする。
  (辿り方は tools/structure/README.md の該当項に書いてある)
