import type { MotionCamera } from './motion-camera.js';
import type { MotionInputAdapter, MotionState } from './motion-input.js';
import {
  HAND_DEBUG_INDICES,
  HAND_CONNECTIONS,
  INPUT_DEBUG_INDICES,
  describeMotionDebug,
  projectDebugPoint,
} from './motion-debug.js';

const states: Record<MotionState, string> = {
  OFF: '停止',
  STARTING: '準備中',
  CALIBRATING: '両手を調整中',
  READY: '新しい手の認識を確認中',
  ACTIVE: '操作可能',
  RECOVERING: '認識が戻ると自動復帰',
  PAUSED: '一時停止',
  ERROR: 'エラー',
};
const labels = [
  [0, '左手'],
  [21, '右手'],
] as const;

/** Reuse SVG nodes; never rebuild the live preview on an inference result. */
export class MotionDebugView {
  private svg: SVGSVGElement;
  private circles: SVGCircleElement[];
  private lines: SVGLineElement[];
  private labels: SVGTextElement[];
  private inputPoints: HTMLElement[];
  private lastFrame: unknown;
  private lastVisible = false;
  constructor(private root: HTMLElement) {
    this.svg = root.querySelector<SVGSVGElement>('#motion-skeleton')!;
    this.svg.innerHTML =
      HAND_CONNECTIONS.map(() => '<line/><line/>').join('') +
      HAND_DEBUG_INDICES.map(() => '<circle/>').join('') +
      labels.map(([, label]) => `<text>${label}</text>`).join('');
    this.lines = [...this.svg.querySelectorAll('line')];
    this.circles = [...this.svg.querySelectorAll('circle')];
    this.labels = [...this.svg.querySelectorAll('text')];
    root.querySelector('#motion-debug-required')!.innerHTML = INPUT_DEBUG_INDICES.map(
      () => '<div></div>',
    ).join('');
    this.inputPoints = [...root.querySelectorAll<HTMLElement>('#motion-debug-required div')];
  }
  private text(id: string, value: string) {
    const node = this.root.querySelector<HTMLElement>(id)!;
    if (node.textContent !== value) node.textContent = value;
  }
  render(camera: MotionCamera, input: MotionInputAdapter, now: number) {
    const frame = camera.debugFrame;
    const view = describeMotionDebug(frame, now);
    const live = camera.previewLive;
    const previewOnly = camera.options.delegate === 'preview';
    const enabled = this.root.querySelector<HTMLInputElement>('#motion-show-skeleton')!.checked;
    const visible = live && view.fresh && view.detected && enabled && !document.hidden;
    this.svg.style.display = visible ? '' : 'none';
    this.root.querySelector<SVGSVGElement>('#motion-guide')!.style.display =
      enabled && live && !visible ? '' : 'none';
    const detection = !live
      ? '映像待ち'
      : previewOnly
        ? '認識なし（映像のみ）'
        : !frame
          ? '認識結果待ち'
          : !view.fresh
            ? '結果の更新待ち'
            : view.detected
              ? view.points[0].quality === 'tracked' && view.points[21].quality === 'tracked'
                ? '両手を認識中'
                : '手を確認中'
              : '両手を映してください';
    this.text('#motion-debug-detection', detection);
    const badge = this.root.querySelector<HTMLElement>('#motion-debug-detection')!;
    badge.dataset.quality = view.detected && live ? 'tracked' : live ? 'uncertain' : 'missing';
    this.text(
      '#motion-debug-model',
      camera.phase === 'model'
        ? '認識モデルを準備中'
        : camera.phase === 'permission'
          ? 'カメラ許可待ち'
          : camera.phase === 'video'
            ? '映像を準備中'
            : camera.phase === 'error'
              ? '起動エラー'
              : camera.phase === 'off'
                ? 'カメラ停止中'
                : previewOnly
                  ? '映像のみ'
                  : `Hands · ${camera.options.delegate} · 認識稼働中`,
    );
    this.text(
      '#motion-debug-input',
      `操作：${states[input.state]} · 手の認識 ${2 - view.missingInput.length}/2`,
    );
    const pointText = (index: number) => {
      const point = view.points[index];
      const count = view.points
        .slice(index, index + 21)
        .filter((p) => p.quality === 'tracked').length;
      return (index === 0 ? '左手' : '右手') + '：' + point.status + ' · 画面内 ' + count + '/21点';
    };
    for (const [i, index] of INPUT_DEBUG_INDICES.entries()) {
      const node = this.inputPoints[i];
      const text = pointText(index);
      if (node.textContent !== text) node.textContent = text;
      node.dataset.quality = view.points[index].quality;
    }
    this.text(
      '#motion-debug-missing',
      !live || previewOnly || !frame
        ? '認識結果を待っています。'
        : !view.fresh
          ? '結果が古いため手のガイドを消しています。新しい認識結果を待っています。'
          : !view.detected
            ? '映像は受信中ですが、手を検出できていません。'
            : view.missingInput.length
              ? `不足・不確か：${view.missingInput.join('・')}`
              : '両手を確認できています。顔・肩・肘は使いません。',
    );
    for (const [id, index] of [
      ['#motion-move-tracking', input.movementHand === 'left' ? 0 : 21],
      ['#motion-action-tracking', input.movementHand === 'left' ? 21 : 0],
    ] as const) {
      const point = view.points[index];
      this.text(
        id,
        point.quality === 'tracked' ? '認識OK' : point.status === '枠外' ? '枠外' : '確認中',
      );
      this.root.querySelector<HTMLElement>(id)!.dataset.quality = point.quality;
    }
    const ms = (key: string) => Math.round(camera.metrics.latest(key));
    const interval = camera.metrics.latest('resultIntervalMs');
    this.text(
      '#motion-debug-timing',
      frame
        ? `取得から ${Math.round(view.ageMs!)} ms · 認識 ${ms('inferenceMs')} ms · ${view.fresh && interval ? `${(1000 / interval).toFixed(1)} 回/秒` : '更新待ち'} · 結果 ${camera.metrics.frames} 件`
        : '認識結果：まだありません',
    );
    if (visible && (frame !== this.lastFrame || !this.lastVisible)) {
      const w = frame!.width,
        h = frame!.height;
      this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      this.svg.style.fontSize = `${w / 30}px`;
      for (const [i, index] of HAND_DEBUG_INDICES.entries()) {
        const point = view.points[index];
        const node = this.circles[i];
        node.style.display = point.quality === 'missing' ? 'none' : '';
        if (point.quality === 'missing' || !point.point) continue;
        const at = projectDebugPoint(point.point, w, h);
        node.setAttribute('cx', String(at.x));
        node.setAttribute('cy', String(at.y));
        node.setAttribute('r', String(w / (index % 21 === 0 ? 110 : 210)));
        node.dataset.quality = point.quality;
      }
      for (const [i, [a, b]] of HAND_CONNECTIONS.entries()) {
        for (let hand = 0; hand < 2; hand++) {
          const start = view.points[a + hand * 21],
            end = view.points[b + hand * 21],
            node = this.lines[i * 2 + hand];
          const show = start.quality === 'tracked' && end.quality === 'tracked';
          node.style.display = show ? '' : 'none';
          if (!show) continue;
          const from = projectDebugPoint(start.point!, w, h),
            to = projectDebugPoint(end.point!, w, h);
          node.setAttribute('x1', String(from.x));
          node.setAttribute('y1', String(from.y));
          node.setAttribute('x2', String(to.x));
          node.setAttribute('y2', String(to.y));
          node.setAttribute('stroke-width', String(w / 280));
        }
      }
      for (const [i, [index]] of labels.entries()) {
        const node = this.labels[i],
          point = view.points[index];
        node.textContent = index === 0 ? '左手' : '右手';
        node.style.display = point.quality === 'missing' ? 'none' : '';
        if (point.quality === 'missing' || !point.point) continue;
        const at = projectDebugPoint(point.point, w, h);
        const labelOnRight = at.x < w * 0.1 || (at.x > w / 2 && at.x < w * 0.9);
        node.setAttribute(
          'x',
          String(
            Math.max(w * 0.02, Math.min(w * 0.98, at.x + (labelOnRight ? 1 : -1) * w * 0.025)),
          ),
        );
        node.setAttribute(
          'y',
          String(Math.max(w * 0.035, Math.min(h - w * 0.015, at.y - w * 0.02))),
        );
        node.setAttribute('text-anchor', labelOnRight ? 'start' : 'end');
      }
    }
    this.lastFrame = frame;
    this.lastVisible = visible;
  }
}
