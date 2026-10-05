const palm =
  '<path d="M24 52V36l-6-9c-3-5 2-8 5-4l5 6V13c0-5 6-5 6 0v13V8c0-5 6-5 6 0v18V11c0-5 6-5 6 0v18V18c0-5 6-5 6 0v22c0 6-4 10-6 12Z"/>';
const glyph = (shape: string, kind = '') =>
  `<svg viewBox="0 0 72 64" class="motion-gesture ${kind}" aria-hidden="true">${shape}</svg>`;
const arrow = '<path class="motion-arrow" d="M8 44V14m-5 6 5-6 5 6"/>';
const gun =
  '<path d="M18 51V35l-5-8c-2-4 2-7 5-4l6 6V12c0-5 6-5 6 0v13h28c5 0 5 6 0 6H39c7 0 7 6 0 6h-1c6 0 6 6 0 6h-2v8Z"/>';
const stroke =
  '<path d="m13 27 14-6h28c5 0 5 5 0 5H37l22 1c4 0 4 5 0 5H37l18 1c4 0 4 5 0 5H35l15 1c4 0 4 5 0 5H25l-12-5Z"/><path class="motion-arrow" d="M15 55h44m-5-5 5 5-5 5m-34-10-5 5 5 5"/>';
const card = (art: string, gesture: string, result: string) =>
  `<div class="motion-lesson-card">${art}<span>${gesture}</span><strong>${result}</strong></div>`;

/** Player-facing guidance is separate from the closed troubleshooting panel. */
export function motionControlsMarkup() {
  return `<div class="motion-toolbar">
    <button type="button" id="motion-open" aria-expanded="false" aria-controls="motion-panel">手であそぶ</button>
    <button type="button" id="motion-quick-stop" hidden>やめる</button>
  </div>
  <div id="motion-hud" hidden>
    <div class="motion-hud-caption"><span id="motion-hand-caption">片手であそぶ</span><span>視点は自動</span></div>
    <div class="motion-current"><span id="motion-direction" aria-hidden="true">●</span><strong id="motion-live-status">とまっています</strong></div>
    <p id="motion-live-notice" role="status" aria-live="polite" hidden></p>
    <p class="motion-stop-hint" id="motion-stop-hint">止まる：左手を戻す・下ろす</p>
    <div id="motion-action-caption" class="motion-hud-caption">右手でアクション</div>
    <div class="motion-action-glance" aria-label="右手の動き">
      <div data-action="jump">${glyph(palm + arrow)}<span>上げてジャンプ</span></div>
      <div data-action="attack">${glyph(gun)}<span>銃の形で攻撃</span></div>
      <div data-action="interact">${glyph(stroke)}<span>横ふりでなでる</span></div>
    </div>
    <p id="motion-interaction-target" hidden></p>
  </div>
  <div id="motion-panel" hidden>
    <div class="motion-heading"><strong id="motion-panel-title">手を合わせよう</strong><button type="button" id="motion-fold">ゲームへ戻る</button></div>
    <div id="motion-setup">
      <div class="motion-steps" aria-label="準備の順番"><span data-step="recognize">1 手を見せる</span><span data-step="neutral">2 楽な位置で止める</span></div>
      <p id="motion-status" role="status" aria-live="polite"></p><p id="motion-setup-hint"></p>
      <progress id="motion-calibration" value="0" max="1" aria-label="手の位置を確認中"></progress>
    </div>
    <div id="motion-preview-wrap">
      <div class="motion-preview"><video id="motion-video" muted playsinline aria-label="自分の手を確認する映像"></video><svg id="motion-guide" viewBox="0 0 320 240" aria-hidden="true"><circle cx="160" cy="158" r="15"/></svg><svg id="motion-skeleton" preserveAspectRatio="xMidYMid meet" aria-hidden="true"></svg><span id="motion-preview-placeholder">カメラを準備しています</span></div>
    </div>
    <div class="motion-buttons" id="motion-recovery-buttons"><button type="button" id="motion-start">もう一度ためす</button></div>
    <div id="motion-lessons" hidden>
      <p class="motion-help-note">いまは止まっています。視点はゲームにおまかせ。</p>
      <div class="motion-lesson-tabs" aria-label="手の動かし方"><button type="button" data-lesson="move" aria-pressed="true">左手で移動</button><button type="button" data-lesson="action" aria-pressed="false">右手でアクション</button></div>
      <div class="motion-lesson-cards" data-lesson-panel="move">
        ${card(glyph(palm + '<path class="motion-arrow" d="M8 45V15m-5 6 5-6 5 6"/>'), 'カメラへ押す', '前へすすむ')}
        ${card(glyph(palm + '<path class="motion-arrow" d="M8 15v30m-5-6 5 6 5-6"/>'), '手前へ引く', '後ろへさがる')}
        ${card(glyph(palm + '<path class="motion-arrow" d="M12 58h48m-5-5 5 5-5 5m-38-10-5 5 5 5"/>'), '左右へ動かす', '左右に曲がる')}
      </div>
      <div class="motion-lesson-cards" data-lesson-panel="action" hidden>
        ${card(glyph(palm + arrow), '開いた手を上げる', 'ジャンプ')}
        ${card(glyph(gun), '胸の前で銃の形', '攻撃')}
        ${card(glyph(stroke), '低い位置で横ふり', 'なでる・調べる')}
      </div>
      <p class="motion-stop-hint">止まるときは、移動する手を元の位置へ戻すか下ろします。</p>
      <p class="motion-help-note" id="motion-single-hint">アクション中は移動を止めます。手を元の位置に戻すと、また移動できます。</p>
      <p class="motion-help-note">手が画面外に出たら、直前の動きを続けます。止めるときは手を画面内へ。</p>
    </div>
    <details id="motion-settings"><summary>カメラ・手の位置を調整</summary>
      <label class="motion-option">カメラ <select id="motion-device"><option value="">ブラウザーの既定</option></select></label>
      <small id="motion-camera-status"></small><small id="motion-camera-help"></small>
      <div class="motion-buttons"><button type="button" id="motion-calibrate" hidden>手の位置を合わせ直す</button><button type="button" id="motion-stop" hidden>手の操作をやめる</button></div>
      <details id="motion-debug-details"><summary>詳しい設定・認識の確認</summary>
        <div class="motion-debug-toolbar"><strong id="motion-debug-detection"></strong><label><input type="checkbox" id="motion-show-skeleton"> 手の関節を表示</label><button type="button" id="motion-expand" aria-pressed="false">映像を拡大</button></div>
        <label class="motion-option">認識 <select id="motion-delegate"><option value="CPU">CPU</option><option value="GPU">GPU（比較用）</option><option value="preview">映像だけ（操作なし）</option></select></label>
        <label class="motion-option">1秒の認識回数 <select id="motion-hz"><option value="10">10</option><option value="15" selected>15</option><option value="20">20</option></select></label><small id="motion-performance"></small><small>認識処理の変更は終了してから行えます。</small>
        <p id="motion-instruction"></p>
        <div class="motion-pads">
          <div class="motion-hand-card"><div class="motion-hand-heading"><strong id="motion-move-label"></strong><span id="motion-move-tracking"></span></div><div class="motion-push"><span id="motion-push-value"></span><progress id="motion-push-progress" value="0" max="1" aria-label="手の押し込み量"></progress><small id="motion-push-detail"></small></div><div class="motion-pad" id="motion-move-pad"><span class="motion-up">前進</span><span class="motion-left">左</span><span class="motion-right">右</span><span class="motion-down">後退</span><i class="motion-home"></i><i class="motion-dot"></i></div><div class="motion-hand-state" id="motion-move-state"></div></div>
          <div class="motion-hand-card"><div class="motion-hand-heading"><strong id="motion-action-label"></strong><span id="motion-action-tracking"></span></div><strong id="motion-pose"></strong><div id="motion-action-pad" class="motion-modes"><span data-pose="open">開く</span><span data-pose="gun">銃</span><span data-pose="stroke">横ふり</span></div><div id="motion-fingers">${[0, 1, 2, 3, 4].map((i) => `<span id="motion-finger-${i}"></span>`).join('')}</div><div class="motion-hand-state" id="motion-action-state"></div><progress id="motion-action-progress" value="0" max="1" aria-label="アクションの確定"></progress><p id="motion-attack-availability"></p></div>
        </div>
        <div id="motion-debug"><strong id="motion-debug-input"></strong><span id="motion-debug-model"></span><span id="motion-debug-missing"></span><div id="motion-debug-required"></div><small id="motion-debug-timing"></small><small>関節の点は推定位置です。手の大きさは停止位置との比較です。</small></div>
      </details>
      <small>映像はこのブラウザー内で処理し、送信・録画・保存しません。</small>
    </details>
  </div>
  <p id="motion-action-feedback" role="status" aria-live="polite" hidden></p>`;
}
