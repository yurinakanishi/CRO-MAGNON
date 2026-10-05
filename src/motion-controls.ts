import { MOTION, MotionInputAdapter, type Hand } from './motion-input.js';
import { MotionCamera, type MotionDelegate, type MotionCameraDevice } from './motion-camera.js';
import { MotionDebugView } from './motion-debug-view.js';
import { motionControlsMarkup } from './motion-controls-markup.js';

interface MotionHooks {
  stop: () => void;
  begin: () => void;
  canStart: () => boolean;
  updateInput: () => void;
}
/** Guided setup, compact play feedback, and optional paused adjustments. */
export class MotionControls {
  readonly input = new MotionInputAdapter();
  readonly camera: MotionCamera;
  readonly root = document.createElement('section');
  interactionHint = '';
  attackStatus = '';
  private timer: number;
  private cleanup: () => void;
  private renderedDevices: MotionCameraDevice[] | null = null;
  private debugView: MotionDebugView;
  private panel: 'setup' | 'help' | 'none' = 'none';
  private lesson: 'move' | 'action' = 'move';
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
    this.root.setAttribute('aria-label', '手であそぶ');
    this.root.innerHTML = motionControlsMarkup();
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
      this.panel = open ? 'help' : 'none';
      if (open) {
        find<HTMLDetailsElement>('#motion-settings').open = false;
        find<HTMLDetailsElement>('#motion-debug-details').open = false;
        find('#motion-panel').scrollTop = 0;
      }
      if (open && this.ownsInput) {
        this.input.pause('操作・調整中');
        hooks.stop();
      }
      this.render();
      if (!open) find('#motion-open').focus({ preventScroll: true });
    };
    find('#motion-fold').onclick = () => fold(false);
    find('#motion-show-skeleton').onchange = () => this.render();
    find('#motion-debug-details').ontoggle = () => this.render();
    find('#motion-settings').ontoggle = () => this.render();
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-lesson]'))
      button.onclick = () => {
        this.lesson = button.dataset.lesson as 'move' | 'action';
        this.render();
      };
    find('#motion-expand').onclick = () => {
      const expanded = this.root.classList.toggle('motion-expanded');
      find('#motion-expand').setAttribute('aria-pressed', String(expanded));
      find('#motion-expand').textContent = expanded ? '元の大きさ' : '拡大';
    };
    const start = () => {
      if (!hooks.canStart()) return;
      this.panel = 'setup';
      find<HTMLDetailsElement>('#motion-settings').open = false;
      find<HTMLDetailsElement>('#motion-debug-details').open = false;
      hooks.begin();
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
    find('#motion-quick-stop').onclick = () => this.stop();
    find('#motion-stop').onclick = () => {
      this.stop();
      this.panel = 'help';
      this.render();
    };
    find('#motion-calibrate').onclick = () => {
      if (!hooks.canStart()) return;
      hooks.stop();
      hooks.begin();
      this.panel = 'setup';
      find<HTMLDetailsElement>('#motion-settings').open = false;
      this.input.calibrate();
      this.render();
    };
    const hide = () => {
      if (document.hidden) this.pause('停止中 · 画面と手を停止位置へ戻すと再開します。');
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
    this.panel = 'none';
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
      this.panel === 'help' ||
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
    // A fresh neutral pose is required before resuming movement or actions.
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
    if (state === 'ERROR') this.panel = 'setup';
    if (state === 'ACTIVE' && this.panel === 'setup') this.panel = 'none';
    const setup = this.panel === 'setup',
      help = this.panel === 'help',
      panelOpen = this.panel !== 'none';
    this.root.dataset.panel = this.panel;
    find('#motion-panel').hidden = !panelOpen;
    find('#motion-hud').hidden = !on || panelOpen;
    find('#motion-open').setAttribute('aria-expanded', String(panelOpen));
    find('#motion-open').hidden = help;
    find('#motion-setup').hidden = !setup;
    find('#motion-lessons').hidden = !help;
    find('#motion-fold').hidden = setup;
    find('#motion-preview-wrap').hidden =
      !setup && !find<HTMLDetailsElement>('#motion-settings').open;
    text('#motion-panel-title', setup ? '手を合わせよう' : '手の動かし方');
    text('#motion-fold', on ? 'ゲームへ戻る' : '閉じる');
    this.debugView.render(this.camera, this.input, performance.now());
    if (this.root.dataset.state !== state) this.root.dataset.state = state;
    text(
      '#motion-open',
      !on ? '手であそぶ' : setup ? '準備中' : help ? 'ゲームへ戻る' : '動かし方・調整',
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
    const neutralStage = this.input.calibrationStage === 'neutral';
    text(
      '#motion-status',
      state === 'ERROR'
        ? 'カメラを確認してください'
        : phase === 'permission'
          ? 'カメラの使用を許可してください'
          : phase === 'video' || phase === 'model'
            ? 'カメラを準備しています'
            : state === 'READY'
              ? 'そのまま、もう少し'
              : neutralStage
                ? '楽な位置で、少し止めてね'
                : '両手をカメラに見せてね',
    );
    text(
      '#motion-setup-hint',
      state === 'ERROR'
        ? this.input.reason
        : phase === 'permission'
          ? 'ブラウザーの「許可」を選びます。'
          : phase === 'video' || phase === 'model'
            ? 'そのままお待ちください。'
            : neutralStage
              ? '肘を下げて、両手が映る楽な位置へ。'
              : '手のひらを画面に向け、指を開きます。',
    );
    for (const step of this.root.querySelectorAll<HTMLElement>('[data-step]'))
      step.classList.toggle('is-current', step.dataset.step === this.input.calibrationStage);
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
    find<HTMLButtonElement>('#motion-open').disabled =
      (!on && !this.hooks.canStart()) || (on && setup);
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
    const moveHand = left ? '左手' : '右手';
    const actionHand = left ? '右手' : '左手';
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-lesson]')) {
      button.setAttribute('aria-pressed', String(button.dataset.lesson === this.lesson));
      button.textContent =
        button.dataset.lesson === 'move' ? `${moveHand}で移動` : `${actionHand}でアクション`;
    }
    for (const lesson of this.root.querySelectorAll<HTMLElement>('[data-lesson-panel]'))
      lesson.hidden = lesson.dataset.lessonPanel !== this.lesson;
    const forward = this.input.forward,
      turn = this.input.turn;
    const motionLabel = forward > 0 ? '前へすすむ' : forward < 0 ? '後ろへさがる' : '';
    const turnLabel = turn > 0 ? '右に曲がる' : turn < 0 ? '左に曲がる' : '';
    const needsHand = state === 'RECOVERING' || (state === 'ACTIVE' && !this.input.movementOffset);
    text(
      '#motion-live-status',
      state === 'PAUSED' || state === 'READY'
        ? '手を元の位置へ'
        : needsHand
          ? `${moveHand}を映してね`
          : [motionLabel, turnLabel].filter(Boolean).join('・') || 'とまっています',
    );
    text(
      '#motion-direction',
      forward > 0
        ? turn > 0
          ? '↗'
          : turn < 0
            ? '↖'
            : '↑'
        : forward < 0
          ? turn > 0
            ? '↘'
            : turn < 0
              ? '↙'
              : '↓'
          : turn > 0
            ? '↱'
            : turn < 0
              ? '↰'
              : '●',
    );
    const notice = this.input.edgeHolding
      ? '手が画面外です · 動きは続いています'
      : state === 'PAUSED' || state === 'READY'
        ? '両手を楽な位置に戻すと再開します'
        : needsHand
          ? 'いまは止まっています'
          : !forward && !turn
            ? `${moveHand}を前へ押すとすすみます`
            : '';
    text('#motion-live-notice', notice);
    find('#motion-live-notice').hidden = !notice;
    text(
      '#motion-stop-hint',
      this.input.edgeHolding
        ? `止まる：${moveHand}を画面内の元の位置へ`
        : `止まる：${moveHand}を戻す・下ろす`,
    );
    find('.motion-action-glance').setAttribute('aria-label', `${actionHand}の動き`);
    text('#motion-action-caption', `${actionHand}でアクション`);
    for (const item of this.root.querySelectorAll<HTMLElement>('[data-action]'))
      item.classList.toggle('is-current', item.dataset.action === this.input.candidate);
    text('#motion-move-label', `${left ? '左' : '右'}手 · 前後と旋回`);
    text('#motion-action-label', `${left ? '右' : '左'}手 · アクション`);
    text(
      '#motion-instruction',
      `${left ? '左' : '右'}手は押して前進、引いて後退、左右で曲がる。${left ? '右' : '左'}手はアクション。視点は自動。`,
    );
    for (const [id, offset] of [
      [
        '#motion-move-pad',
        this.input.movementOffset
          ? { x: this.input.turn * 0.55, y: -this.input.forward * 0.55 }
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
    find('#motion-interaction-target').hidden = !this.interactionHint || state !== 'ACTIVE';
    text('#motion-attack-availability', this.attackStatus);
    find('#motion-attack-availability').hidden = !this.attackStatus || state !== 'ACTIVE';
    text(
      '#motion-action-state',
      state !== 'ACTIVE'
        ? state === 'CALIBRATING'
          ? '最初の構えを確認中'
          : '停止位置に戻すと再開します'
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
        open: '開いた手 · 上げるとジャンプ',
        gun: '銃の形 · 攻撃',
        stroke: '低い横振り · 調べる',
        other: '手の形を確認中',
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
      find(`#motion-finger-${i}`).dataset.gun = String(
        i !== 2 && finger === (i < 2 ? 'extended' : 'folded'),
      );
    }
    const move = this.input.movementOffset;
    const moving = state === 'ACTIVE' && (this.input.forward !== 0 || this.input.turn !== 0);
    const push = this.input.movementPush;
    const amount = push === null ? 0 : Math.max(0, Math.min(1, Math.abs(push) / MOTION.pushRange));
    find<HTMLProgressElement>('#motion-push-progress').value = amount;
    text(
      '#motion-push-value',
      !this.input.calibration
        ? '調整待ち'
        : this.input.edgeHolding
          ? '画面外 · 直前の入力'
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
        : this.input.edgeHolding
          ? '手を画面内へ戻すと現在の動きに切り替わります'
          : palm === null
            ? '手のひらを映してください'
            : `手のひら ${Math.round(palm * 100)}%${finger === null ? ' · 指先は枠外' : ` · 指先まで ${Math.round(finger * 100)}%`}`,
    );
    find('.motion-push').classList.toggle('motion-advancing', !!moving);
    const directions = [
      this.input.forward > 0 ? '前進' : this.input.forward < 0 ? '後退' : '',
      this.input.turn > 0 ? '右へ旋回' : this.input.turn < 0 ? '左へ旋回' : '',
    ].filter(Boolean);
    text(
      '#motion-move-state',
      state !== 'ACTIVE'
        ? state === 'CALIBRATING'
          ? '最初の構えを確認中'
          : '停止位置に戻すと再開します'
        : this.input.edgeHolding
          ? `${directions.join(' ＋ ')} · 画面外で継続`
          : !move
            ? '移動の手を確認中 · 反対の手は使えます'
            : directions.join(' ＋ ') || '停止 · 押す／引く／左右で操縦',
    );
    find('#motion-move-pad').dataset.forward = this.input.forward.toFixed(3);
    find('#motion-move-pad').dataset.turn = this.input.turn.toFixed(3);
    for (const [selector, selected] of [
      ['.motion-up', this.input.forward > 0],
      ['.motion-left', this.input.turn < 0],
      ['.motion-right', this.input.turn > 0],
      ['.motion-down', this.input.forward < 0],
    ] as const)
      find(`#motion-move-pad ${selector}`).classList.toggle('motion-selected', selected);
    const feedback = this.actionFeedback;
    const showFeedback =
      on &&
      !panelOpen &&
      !!feedback &&
      feedback.session === this.input.sessionId &&
      feedback.until > performance.now();
    find('#motion-action-feedback').hidden = !showFeedback;
    if (showFeedback) {
      text('#motion-action-feedback', feedback.message);
      find('#motion-action-feedback').dataset.accepted = String(feedback.accepted);
    }
  }
}
