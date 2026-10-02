// Called from the isolated real-browser game QA. Uses its loaded, actual GLB and
// renderer with a separate scene and explicit clock to exercise phase boundaries.
export async function verifyRimoHappyLifecycle(page) {
  return page.evaluate(async () => {
    const { RimoNekoRenderer } = await import('/src/rimo-neko-renderer.js');
    const { RIMO_NEKO } = await import('/shared/rimo-neko.mjs');
    const T = window.qaThree;
    const checks = [];
    const expect = (yes, message) => { if (!yes) throw Error(message); checks.push(message); };
    let now = 10000;
    const cat = { ...qaRimo.state.rimoNeko, x: 40, z: 55, facing: 0,
      petSequence: 5, petAt: 9000, petContactAt: 10000, petPlayerId: 'qa',
      hitSequence: 0, hitAt: 0 };
    const make = () => {
      const labels = [];
      const world = { scene: new T.Scene(), camera: new T.PerspectiveCamera(),
        state: { rimoNeko: { ...cat } }, collision: qaRimo.collision,
        worldAssets: qaRimo.worldAssets, serverNow: () => now, labels,
        createLabel: (_text, _type, position) => {
          const label = { element: document.createElement('div'), position, active: false };
          labels.push(label); return label;
        } };
      world.camera.position.set(40, 2, 58);
      const r = new RimoNekoRenderer(world);
      r.update(0); // Place the fixture without treating its initial offset as movement.
      return { world, r };
    };
    const a = make(); let b;
    try {
      now = cat.petContactAt + RIMO_NEKO.petStrokeMs - 1;
      a.r.update(1 / 60);
      expect(a.r.diagnostics().reaction === 'pet' && a.r.diagnostics().hearts === 0, 'no hearts before completed strokes');
      now = cat.petContactAt + RIMO_NEKO.petStrokeMs + 700;
      a.r.update(1 / 60);
      expect(a.r.diagnostics().reaction === 'happy' && a.r.diagnostics().hearts >= 3, 'completed pet shows head-tilt clip and rising hearts');
      b = make(); b.r.update(1 / 60);
      const state = r => r.hearts.map(h => ({ visible: h.visible, p: h.position.toArray(), size: h.scale.x, alpha: h.material.opacity }));
      expect(JSON.stringify(state(a.r)) === JSON.stringify(state(b.r)), 'late-created renderer joins the same heart phase');
      const headA = a.r.actor.root.getObjectByName('Head').quaternion;
      // GLB float32 quaternions need normalization for an acos-based angle test.
      const headB = b.r.actor.root.getObjectByName('Head').quaternion;
      expect(headA.clone().normalize().angleTo(headB.clone().normalize()) < 1e-6, 'late-created renderer joins the same head pose');
      a.world.camera.position.x += 100; a.r.update(1 / 60);
      expect(a.r.diagnostics().hearts === 0, 'distant cat has no visible hearts');
      now += 120; a.world.camera.position.x -= 100; a.r.update(1 / 60); b.r.update(1 / 60);
      expect(JSON.stringify(state(a.r)) === JSON.stringify(state(b.r)), 'return from culling resumes current phase without replay');
      a.world.state.rimoNeko.petPlayerId = null; a.r.update(1 / 60);
      expect(a.r.diagnostics().hearts === 0, 'cancelled pet clears all hearts');
      a.world.state.rimoNeko.petPlayerId = 'qa';
      a.world.state.rimoNeko.hitSequence = 1; a.world.state.rimoNeko.hitAt = now;
      a.r.update(1 / 60);
      expect(a.r.diagnostics().reaction === 'hit' && a.r.diagnostics().hearts === 0, 'hit immediately overrides the happy reaction');
      now += RIMO_NEKO.hitMs + 100; a.r.update(1 / 60);
      expect(a.r.diagnostics().reaction === 'hiss' && a.r.diagnostics().hearts === 0, 'hiss never carries affection hearts');
      a.world.state.rimoNeko.hitSequence = 0;
      now = cat.petContactAt + RIMO_NEKO.petStrokeMs + RIMO_NEKO.happyMs;
      a.r.update(1 / 60);
      expect(a.r.diagnostics().reaction === 'idle' && a.r.diagnostics().hearts === 0, 'expired shared timestamp cannot replay the gesture');
      now = cat.petContactAt + RIMO_NEKO.petStrokeMs + 700; a.r.update(1 / 60);
      a.world.state.rimoNeko = undefined; a.r.update(1 / 60);
      expect(!a.r.root.visible && a.r.diagnostics().hearts === 0, 'missing companion leaves no orphan hearts');
      let disposed = 0;
      for (const h of a.r.hearts) h.material.addEventListener('dispose', () => disposed++);
      a.r.hearts[0].material.map.addEventListener('dispose', () => disposed++);
      a.r.dispose();
      expect(disposed === 6 && a.world.scene.children.length === 0 && a.world.labels.length === 0, 'dispose removes all heart sprites, materials, texture and labels');
      return checks;
    } finally { b?.r.dispose(); if (a.r.root.parent) a.r.dispose(); }
  });
}
