import { MOTION, MotionNavigation, MotionInputAdapter, type Hand } from './motion-input.js';
import { MotionCamera, type MotionDelegate, type MotionCameraDevice } from './motion-camera.js';
import { MotionDebugView } from './motion-debug-view.js';

interface MotionHooks {
  stop: () => void;
  begin: () => void;
  canStart: () => boolean;
  updateInput: () => void;
}
/** Staff controls remain clickable during calibration and tracking loss. */
export class MotionControls {
  readonly input = new MotionInputAdapter();
  readonly navigation = new MotionNavigation();
  readonly camera: MotionCamera;
  readonly root = document.createElement('section');
  interactionHint = '手のひらを水平にして横なで → 近くを調べる・採取・撫でる';
  attackStatus = '';
  private timer: number;
  private cleanup: () => void;
  private renderedDevices: MotionCameraDevice[] | null = null;
  private debugView: MotionDebugView;
  private actionFeedback: {
    message: string;
    accepted: boolean;
    until: number;
    session: number;
  } | null = null;
  constructor(
    parent: HTMLElement,
    private hooks: MotionHooks,
  ) {
    this.root.id = 'motion-controls';
    this.root.setAttribute('aria-label', '両手のカメラ操作');
    this.root.innerHTML = `<div class="motion-toolbar"><button type="button" id="motion-open" aria-expanded="false">カメラで遊ぶ</button><button type="button" id="motion-quick-stop" hidden>通常操作に戻す</button></div>
      <div id="motion-panel" hidden>
        <div class="motion-heading"><strong>手で、谷を歩こう</strong><button type="button" id="motion-fold" aria-label="カメラ操作パネルを小さくする">小さくする</button></div>
        <p id="motion-status" role="status" aria-live="polite"></p>
        <progress id="motion-calibration" value="0" max="1" aria-label="両手の位置の調整"></progress>
        <div class="motion-buttons" id="motion-recovery-buttons"><button type="button" id="motion-start">カメラを開始</button></div>
        <div class="motion-live"><div>
        <div class="motion-preview"><video id="motion-video" muted playsinline aria-label="このPCだけの鏡像プレビュー"></video><svg id="motion-guide" viewBox="0 0 320 240" aria-hidden="true"><circle cx="120" cy="158" r="15"/><circle cx="200" cy="158" r="15"/><text x="160" y="229" text-anchor="middle">手のひらをカメラへ</text></svg><svg id="motion-skeleton" preserveAspectRatio="xMidYMid meet" aria-hidden="true"></svg><span id="motion-preview-placeholder">上の「カメラを開始」で映像を表示</span></div>
        <div class="motion-debug-toolbar"><strong id="motion-debug-detection">認識結果待ち</strong><label><input type="checkbox" id="motion-show-skeleton" checked> 手のガイド</label><button type="button" id="motion-expand" aria-pressed="false">拡大</button></div>
        <p id="motion-instruction">左手で移動とジャンプ、右手で視点とアクション。</p>
        <small>手が見えれば自動復帰。止まるときは押し込みと傾きを戻します。</small>
        <p id="motion-interaction-target"></p>
        <p id="motion-attack-availability"></p>
        <p id="motion-action-feedback" role="status" aria-live="polite" hidden></p>
        </div>
        <div class="motion-pads">
          <div class="motion-hand-card"><div class="motion-hand-heading"><strong id="motion-move-label">左手 · 移動</strong><span id="motion-move-tracking"></span></div><div class="motion-push"><div><strong>カメラへ押す → 前進</strong><span id="motion-push-value">調整待ち</span></div><progress id="motion-push-progress" value="0" max="1" aria-label="手の押し込み量"></progress><small id="motion-push-detail">手のひらを正面に向けて押す</small></div><div class="motion-pad" id="motion-move-pad"><span class="motion-up">押す → 前進</span><span class="motion-left">左へ傾ける</span><span class="motion-right">右へ傾ける</span><span class="motion-down">引く・下げる → 後退</span><i class="motion-home"></i><i class="motion-dot"></i></div><div class="motion-hand-state" id="motion-move-state"></div><div class="motion-jump">手を上げる → ジャンプ<br><small>下ろすと次のジャンプができます</small></div></div>
          <div class="motion-hand-card motion-action-card"><div class="motion-hand-heading"><strong id="motion-action-label">右手 · 視点とアクション</strong><span id="motion-action-tracking"></span></div>
            <strong id="motion-pose">手の形を確認中</strong>
            <div id="motion-action-pad" class="motion-modes">
              <div data-pose="camera"><strong>開いた手 → 視点</strong><small>空中を上下左右になぞる</small></div>
              <div data-pose="gun"><strong>銃の形 → 攻撃</strong><small>親・人・中を伸ばし、薬・小を曲げる</small></div>
              <div data-pose="stroke"><strong>手のひらを下へ → 横なで</strong><small>近くを撫でる・採取・調べる</small></div>
            </div>
            <div id="motion-fingers" aria-label="操作する手の各指の認識状態"><span id="motion-finger-0"></span><span id="motion-finger-1"></span><span id="motion-finger-2"></span><span id="motion-finger-3"></span><span id="motion-finger-4"></span></div>
            <small>銃の形に合う指は緑：伸・伸・伸・曲・曲</small><div class="motion-hand-state" id="motion-action-state"></div><progress id="motion-action-progress" value="0" max="1" aria-label="アクションの確定"></progress>
            <div class="motion-view"><div id="motion-camera-pad"><i id="motion-camera-dot"></i></div><span id="motion-camera-state">視点は停止</span><small>軽く握って戻すと、視点を動かさず持ち替えられます。</small></div>
          </div>
        </div></div>
        <details id="motion-debug-details"><summary>認識の詳細</summary><div id="motion-debug" aria-label="カメラ認識の現在の状態">
          <strong id="motion-debug-input"></strong><span id="motion-debug-model"></span>
          <span id="motion-debug-missing"></span>
          <strong>手首から指先までの認識</strong>
          <div id="motion-debug-required"></div>
          <small>両手の各21点を追跡します。顔・肩・肘は認識しません。</small>
          <small>緑の点と線は今回認識した手の関節です。未確認・枠外・古い点は描きません。</small>
          <small>手の形と相対的な奥行きから傾きを補正し、大きさの変化で前後を判定します。100%は調整時の大きさで、実距離ではありません。</small>
          <small id="motion-debug-timing"></small>
        </div></details>
        <details id="motion-settings"><summary>カメラ・操作の設定</summary>
        <label class="motion-option">使用するカメラ <select id="motion-device"><option value="">ブラウザーの既定</option></select></label>
        <small id="motion-camera-status"></small><small id="motion-camera-help"></small>
        <label class="motion-option">移動する手 <select id="motion-hand"><option value="left">左手</option><option value="right">右手</option></select></label>
        <div class="motion-buttons"><button type="button" id="motion-calibrate" hidden>手の位置を合わせ直す</button><button type="button" id="motion-stop" hidden>終了・通常操作へ</button></div>
        <details><summary>認識処理の設定</summary><label class="motion-option">認識 <select id="motion-delegate"><option value="CPU">CPU</option><option value="GPU">GPU（比較用）</option><option value="preview">映像だけ（操作なし）</option></select></label><label class="motion-option">1秒の認識回数 <select id="motion-hz"><option value="10">10</option><option value="15" selected>15</option><option value="20">20</option></select></label><small id="motion-performance"></small><small>移動する手・認識処理の変更は終了してから行えます。</small></details>
        <small>枠外への移動は0.6秒継続し、0.3秒で減速します。手が映れば自動復帰します。カメラ旋回は見失うとすぐ止まります。</small></details>
        <small>映像はこのブラウザー内で処理。送信・録画・保存しません。</small>
      </div>`;
    parent.append(this.root);
    this.debugView = new MotionDebugView(this.root);
    const find = <T extends HTMLElement>(id: string) => this.root.querySelector<T>(id)!;
    this.camera = new MotionCamera(
      this.input,
      find<HTMLVideoElement>('#motion-video'),
      () => this.render(),
      hooks.stop,
      hooks.updateInput,
    );
    const fold = (open: boolean) => {
      find('#motion-panel').hidden = !open;
      find('#motion-open').setAttribute('aria-expanded', String(open));
    };
    find('#motion-fold').onclick = () => fold(false);
    find('#motion-show-skeleton').onchange = () => this.render();
    find('#motion-debug-details').ontoggle = () => this.render();
    find('#motion-expand').onclick = () => {
      const expanded = this.root.classList.toggle('motion-expanded');
      find('#motion-expand').setAttribute('aria-pressed', String(expanded));
      find('#motion-expand').textContent = expanded ? '元の大きさ' : '拡大';
    };
    const start = () => {
      if (!hooks.canStart()) return;
      fold(true);
      hooks.begin();
      this.navigation.reset(performance.now());
      this.input.movementHand = find<HTMLSelectElement>('#motion-hand').value as Hand;
      document.exitPointerLock?.();
      void this.camera.start({
        delegate: find<HTMLSelectElement>('#motion-delegate').value as MotionDelegate,
        hz: Number(find<HTMLSelectElement>('#motion-hz').value) as 10 | 15 | 20,
        deviceId: find<HTMLSelectElement>('#motion-device').value || undefined,
      });
      find('#motion-panel').scrollTop = 0;
    };
    // The camera entry point is the explicit opt-in. Opening an empty preview
    // must not require finding a second start button below the fold.
    find('#motion-open').onclick = () => {
      if (!this.ownsInput) start();
      else fold(find('#motion-panel').hidden === true);
    };
    find('#motion-start').onclick = start;
    find('#motion-device').onchange = () => {
      if (this.ownsInput) start();
    };
    for (const id of ['#motion-stop', '#motion-quick-stop']) find(id).onclick = () => this.stop();
    find('#motion-calibrate').onclick = () => {
      if (!hooks.canStart()) return;
      hooks.stop();
      hooks.begin();
      this.navigation.reset(performance.now());
      this.input.calibrate();
      this.render();
    };
    const hide = () => {
      if (document.hidden) this.pause('画面を離れたため停止しました。戻ると自動で再開します。');
    };
    const blur = () => this.pause();
    const pagehide = () => this.stop();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('blur', blur);
    window.addEventListener('pagehide', pagehide);
    this.cleanup = () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pagehide', pagehide);
    };
    this.timer = window.setInterval(() => this.render(), 150);
    this.render();
  }
  get ownsInput() {
    return this.input.ownsInput;
  }
  reportAction(message: string, accepted: boolean) {
    this.actionFeedback = {
      message,
      accepted,
      until: performance.now() + 1800,
      session: this.input.sessionId,
    };
    this.render();
  }
  pause(reason?: string) {
    if (!this.ownsInput) return;
    const previous = this.input.state;
    this.input.pause(reason);
    if (previous !== this.input.state) {
      this.hooks.stop();
      this.render();
    }
  }
  stop() {
    this.camera.stop();
  }
  destroy() {
    this.stop();
    clearInterval(this.timer);
    this.cleanup();
    this.root.remove();
  }
  private resumeWhenReady() {
    if (
      this.input.state !== 'PAUSED' ||
      this.camera.options.delegate === 'preview' ||
      this.camera.phase !== 'live' ||
      !this.camera.previewLive ||
      !this.hooks.canStart() ||
      !document.hasFocus()
    )
      return;
    const focusedField = document.activeElement?.closest('input,textarea,select,[contenteditable]');
    const track = (this.camera.video.srcObject as MediaStream | null)?.getVideoTracks()[0];
    if (focusedField || !track || track.readyState !== 'live' || track.muted) return;
    this.hooks.stop();
    this.hooks.begin();
    this.navigation.reset(performance.now());
    // Fresh hands resume independently. Reacquired action poses are not new presses.
    this.input.resume();
  }
  render() {
    this.resumeWhenReady();
    const find = <T extends HTMLElement>(id: string) => this.root.querySelector<T>(id)!;
    // Inference and the status timer share this view. Leave unchanged text nodes
    // intact instead of rebuilding the entire accessible panel every frame.
    const text = (id: string, value: string) => {
      const node = find(id);
      if (node.textContent !== value) node.textContent = value;
    };
    const state = this.input.state,
      on = this.input.ownsInput,
      phase = this.camera.phase;
    this.debugView.render(this.camera, this.input, performance.now());
    if (this.root.dataset.state !== state) this.root.dataset.state = state;
    text(
      '#motion-open',
      !on
        ? 'カメラで遊ぶ'
        : phase === 'permission'
          ? 'カメラ · 許可待ち'
          : phase === 'video'
            ? 'カメラ · 映像を準備中'
            : phase === 'model'
              ? 'カメラ · 認識を準備中'
              : this.camera.options.delegate === 'preview'
                ? 'カメラ映像を表示中'
                : state === 'CALIBRATING'
                  ? 'カメラ · 両手を調整中'
                  : state === 'RECOVERING'
                    ? 'カメラ · 手を確認中'
                    : state === 'READY'
                      ? 'カメラ · 両手を確認中'
                      : state === 'ACTIVE'
                        ? 'カメラ操作中'
                        : 'カメラ操作 · 停止中',
    );
    const device = find<HTMLSelectElement>('#motion-device');
    if (this.renderedDevices !== this.camera.devices) {
      const selected = this.camera.activeDeviceId || device.value;
      device.replaceChildren(new Option('ブラウザーの既定', ''));
      for (const camera of this.camera.devices)
        device.add(new Option(camera.label, camera.deviceId));
      device.value = this.camera.devices.some((camera) => camera.deviceId === selected)
        ? selected
        : '';
      this.renderedDevices = this.camera.devices;
    }
    device.disabled = !this.hooks.canStart() || ['permission', 'video'].includes(phase);
    const live = this.camera.previewLive;
    find('#motion-preview-placeholder').hidden = live;
    text(
      '#motion-preview-placeholder',
      phase === 'permission'
        ? 'ブラウザーでカメラを許可してください'
        : phase === 'error'
          ? 'カメラ映像を表示できません'
          : phase === 'off'
            ? '上の「カメラを開始」で映像を表示'
            : 'カメラ映像を準備しています…',
    );
    find('#motion-camera-status').hidden = !live;
    text(
      '#motion-camera-status',
      live
        ? `${this.camera.deviceLabel} · ${this.camera.video.videoWidth} × ${this.camera.video.videoHeight} · 映像受信中`
        : '',
    );
    text(
      '#motion-camera-help',
      live
        ? '黒く映る場合はレンズカバーを開けるか、使用するカメラを切り替えてください。'
        : phase === 'permission'
          ? 'ブラウザーの許可画面で、このサイトのカメラ使用を許可してください。'
          : phase === 'error'
            ? '下のメッセージを確認し、カメラを選んで上の「カメラを開始」を押してください。'
            : phase === 'off'
              ? '「カメラを開始」を押すと、ここに映像が表示されます。'
              : 'カメラが準備できると、ここに映像が表示されます。',
    );
    text(
      '#motion-status',
      this.input.reason ||
        '両手のひらを正面へ向け、手首から指先まで映してください。顔や肩は不要です。',
    );
    if (find<HTMLDetailsElement>('#motion-settings').open) {
      const ms = (key: string) => Math.round(this.camera.metrics.latest(key));
      text(
        '#motion-performance',
        this.camera.metrics.frames
          ? `認識処理 ${ms('inferenceMs')} ms / 取得から結果 ${ms('captureToResultMs')} ms / 結果の間隔 ${ms('resultIntervalMs')} ms / 短い遅延 ${this.input.briefInterruptions} 回`
          : '認識結果を待っています。',
      );
    }
    find('#motion-start').hidden = on;
    find<HTMLButtonElement>('#motion-start').disabled = !this.hooks.canStart();
    find<HTMLButtonElement>('#motion-open').disabled = !on && !this.hooks.canStart();
    for (const id of ['#motion-stop', '#motion-quick-stop']) find(id).hidden = !on;
    find('#motion-recovery-buttons').hidden = !!find('#motion-start').hidden;
    find('#motion-calibrate').hidden =
      !on || state === 'STARTING' || this.camera.options.delegate === 'preview';
    for (const id of ['#motion-hand', '#motion-delegate', '#motion-hz'])
      find<HTMLSelectElement>(id).disabled = on;
    find<HTMLProgressElement>('#motion-calibration').value = this.input.calibrationProgress;
    find('#motion-calibration').hidden = state !== 'CALIBRATING';
    find<HTMLProgressElement>('#motion-action-progress').value = this.input.actionProgress;
    const left = this.input.movementHand === 'left';
    text('#motion-move-label', `${left ? '左' : '右'}手 · 移動とジャンプ`);
    text('#motion-action-label', `${left ? '右' : '左'}手 · 視点とアクション`);
    text(
      '#motion-instruction',
      `${left ? '左' : '右'}手は押して前進、引く・下げると後退、傾けると横移動。${left ? '右' : '左'}手で視点を動かしても人物は回りません。`,
    );
    for (const [id, offset] of [
      [
        '#motion-move-pad',
        this.input.movementOffset
          ? { x: this.input.strafe * 0.55, y: -this.input.forward * 0.55 }
          : null,
      ],
    ] as const) {
      const dot = find<HTMLElement>(`${id} .motion-dot`);
      dot.hidden = !offset;
      if (offset) {
        dot.style.left = `${50 + Math.max(-0.55, Math.min(0.55, offset.x)) * 70}%`;
        dot.style.top = `${50 + Math.max(-0.55, Math.min(0.55, offset.y)) * 70}%`;
      }
    }
    const action = this.input.candidate;
    const act = this.input.actionOffset;
    text('#motion-interaction-target', this.interactionHint);
    text('#motion-attack-availability', this.attackStatus);
    find('#motion-attack-availability').hidden = !this.attackStatus || state !== 'ACTIVE';
    text(
      '#motion-action-state',
      state !== 'ACTIVE'
        ? state === 'CALIBRATING'
          ? '最初の構えを確認中'
          : '手が映ると自動で続けられます'
        : !act
          ? '手を戻すと続けられます'
          : action
            ? this.input.actionProgress >= 1
              ? '動きを認識しました'
              : {
                  attack: '銃の形を確認中',
                  jump: '上げる動きを確認中',
                  interact: '横なでを確認中',
                }[action]
            : this.input.actionHint,
    );
    const pose = state === 'ACTIVE' ? this.input.actionPose : 'unknown';
    text(
      '#motion-pose',
      {
        camera: '開いた手 · 視点',
        gun: '銃の形 · 攻撃',
        stroke: '水平な手 · 横なで',
        other: '持ち替え · 視点停止',
        unknown: '手の形を確認中',
      }[pose],
    );
    find('#motion-pose').dataset.pose = pose;
    for (const region of this.root.querySelectorAll<HTMLElement>('#motion-action-pad [data-pose]'))
      region.classList.toggle('motion-selected', region.dataset.pose === pose);
    for (const [i, label] of ['親', '人', '中', '薬', '小'].entries()) {
      const finger = this.input.actionFingers?.[i] ?? 'unknown';
      text(
        `#motion-finger-${i}`,
        `${label}\n${{ extended: '伸', folded: '曲', unknown: '?' }[finger]}`,
      );
      find(`#motion-finger-${i}`).dataset.finger = finger;
      find(`#motion-finger-${i}`).dataset.gun = String(finger === (i < 3 ? 'extended' : 'folded'));
    }
    const move = this.input.movementOffset;
    const moving = state === 'ACTIVE' && (this.input.forward !== 0 || this.input.strafe !== 0);
    const push = this.input.movementPush;
    const amount = push === null ? 0 : Math.max(0, Math.min(1, Math.abs(push) / MOTION.pushRange));
    find<HTMLProgressElement>('#motion-push-progress').value = amount;
    text(
      '#motion-push-value',
      !this.input.calibration
        ? '調整待ち'
        : push === null
          ? '手の形を確認中'
          : `手の大きさ ${Math.round((1 + push) * 100)}%`,
    );
    const palm = this.input.palmRatio,
      finger = this.input.fingerRatio;
    text(
      '#motion-push-detail',
      !this.input.calibration
        ? '指を伸ばし、手のひらを正面へ'
        : palm === null
          ? '手のひらを映してください'
          : `手のひら ${Math.round(palm * 100)}%${finger === null ? ' · 指先は枠外' : ` · 指先まで ${Math.round(finger * 100)}%`}`,
    );
    find('.motion-push').classList.toggle('motion-advancing', !!moving);
    const directions = [
      this.input.forward > 0 ? '前進' : this.input.forward < 0 ? '後退' : '',
      this.input.strafe > 0 ? '右へ移動' : this.input.strafe < 0 ? '左へ移動' : '',
    ].filter(Boolean);
    text(
      '#motion-move-state',
      this.input.holdingMovement
        ? '枠外 · 移動を継続 → 減速'
        : state !== 'ACTIVE'
          ? state === 'CALIBRATING'
            ? '最初の構えを確認中'
            : '手が映ると続けられます'
          : !move
            ? '移動の手を確認中 · 反対の手は使えます'
            : directions.join(' ＋ ') || '停止 · 押す／引く／傾けると移動',
    );
    const view = this.input.cameraDelta;
    text(
      '#motion-camera-state',
      pose === 'camera'
        ? [
            view.x > 0 ? '右へ' : view.x < 0 ? '左へ' : '',
            view.y > 0 ? '下へ' : view.y < 0 ? '上へ' : '',
          ]
            .filter(Boolean)
            .join('・') || '手と一緒に視点も停止'
        : '視点は停止',
    );
    find('#motion-camera-dot').style.left = `${50 + Math.max(-1, Math.min(1, view.x * 8)) * 43}%`;
    find('#motion-camera-dot').style.top = `${50 + Math.max(-1, Math.min(1, view.y * 8)) * 38}%`;
    find('#motion-move-pad').dataset.forward = this.input.forward.toFixed(3);
    find('#motion-move-pad').dataset.strafe = this.input.strafe.toFixed(3);
    find('#motion-camera-state').dataset.yaw = view.x.toFixed(3);
    find('#motion-camera-state').dataset.pitch = view.y.toFixed(3);
    for (const [selector, selected] of [
      ['.motion-up', this.input.forward > 0],
      ['.motion-left', this.input.strafe < 0],
      ['.motion-right', this.input.strafe > 0],
      ['.motion-down', this.input.forward < 0],
    ] as const)
      find(`#motion-move-pad ${selector}`).classList.toggle('motion-selected', selected);
    const feedback = this.actionFeedback;
    const showFeedback =
      !!feedback && feedback.session === this.input.sessionId && feedback.until > performance.now();
    find('#motion-action-feedback').hidden = !showFeedback;
    if (showFeedback) {
      text('#motion-action-feedback', feedback.message);
      find('#motion-action-feedback').dataset.accepted = String(feedback.accepted);
    }
  }
}
