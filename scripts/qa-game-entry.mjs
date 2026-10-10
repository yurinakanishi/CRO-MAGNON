// Drive the real gallery-to-world button after a QA visitor confirms their setup.
// The world does not join the room until this gesture; waiting only for the actor
// would test neither entry nor touch input and would time out in the gallery.
export async function enterPreparedWorld(page, mobile, timeout = 180000) {
  await page.waitForFunction(
    () => {
      const world = document.querySelector('#world');
      return (
        document.querySelector('#loading-cave[data-world-ready="true"]') ||
        (world?.dataset.worldAsset === 'ready' && world?.dataset.characterAsset === 'ready')
      );
    },
    undefined,
    { timeout },
  );
  if (await page.locator('#loading-cave').count()) {
    const proceed = page.locator('[data-cave-proceed]');
    if (mobile) await proceed.tap();
    else await proceed.click();
    await page.locator('#loading-cave').waitFor({ state: 'detached', timeout });
  }
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout });
}
