import { loadMultiplayerConfig } from './multiplayer-config.js';
import { renderTitleShell, type TitleShellSession } from './title-shell.js';
import { startupMarks } from './startup-marks.js';

/**
 * The page entry. The title is drawn and usable from modules that load no 3D or
 * world data (title-shell.ts); the game module is imported once, as soon as that
 * title has been painted, and takes the title over (main.ts). ?autostart=1 keeps
 * the direct start without a title.
 */
const GAME_FAILED = 'ゲームを読み込めませんでした。通信を確認して再読み込みしてください。';
const app = document.getElementById('app')!;

/** The game module failed after it took the title: an explicit panel with a reload. */
function failedAfterHandoff(message: string) {
  const panel = document.createElement('div');
  panel.className = 'context-recovery';
  panel.setAttribute('role', 'alert');
  panel.innerHTML =
    '<strong>ゲームを開始できませんでした</strong><p></p><button type="button" class="button button-accent">再読み込み</button>';
  panel.querySelector('p')!.textContent = message;
  panel.querySelector('button')!.onclick = () => location.reload();
  (document.querySelector('.game-viewport') ?? document.body).append(panel);
}

function loadGame(shell: TitleShellSession | null) {
  import('./main.js').catch((error) => {
    console.error('The game module could not start:', error);
    if (shell && !shell.taken) {
      // A configuration failure is already shown with its own message.
      if (!shell.failed) shell.fail(GAME_FAILED);
    } else if (!shell?.failed) failedAfterHandoff(GAME_FAILED);
  });
}

if (new URLSearchParams(location.search).get('autostart') === '1') loadGame(null);
else {
  const config = loadMultiplayerConfig();
  const shell = renderTitleShell(app, config);
  config.catch((error) => shell.fail(error?.message || '接続設定を読み込めません。'));
  // The game module starts once, as soon as the title and its handlers have been
  // painted; without a configuration it cannot run. A hidden page paints no frame,
  // so it starts the game at once, as the page did before the shell.
  let started = false;
  const startGame = () => {
    if (started) return;
    started = true;
    document.removeEventListener('visibilitychange', startHidden);
    if (!shell.failed) loadGame(shell);
  };
  const startHidden = () => {
    if (document.visibilityState === 'hidden') startGame();
  };
  document.addEventListener('visibilitychange', startHidden);
  startHidden();
  requestAnimationFrame(() =>
    setTimeout(() => {
      // The title has been drawn with working controls.
      startupMarks.page('title-interactive');
      startGame();
    }, 0),
  );
}
