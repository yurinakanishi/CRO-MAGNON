import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldRenderer } from '../dist/src/world3d.js';
import { contextCues } from '../dist/src/input-cues.js';

test('automatic camera rejects rotation, zoom and closeup even between input updates', () => {
  for (const automaticHeading of [null, 1.2]) {
    const camera = {
      yaw: 1,
      pitch: 0.2,
      targetDistance: 6.5,
      zoom: 1,
      automaticHeading,
      companionView: null,
      manualCameraAllowed: () => false,
      manualInputAllowed: () => true,
    };
    WorldRenderer.prototype.rotateCamera.call(camera, 1, 1);
    WorldRenderer.prototype.setZoom.call(camera, 3);
    assert.equal(WorldRenderer.prototype.viewCompanion.call(camera), false);
    assert.deepEqual([camera.yaw, camera.pitch, camera.targetDistance], [1, 0.2, 6.5]);
  }
});

test('drag and wheel leave an automatic view unchanged while normal mode still supports both', () => {
  let automatic = true;
  const camera = {
    canvas: {
      style: {},
      addEventListener() {},
      focus() {},
      setPointerCapture() {},
      hasPointerCapture: () => false,
    },
    pointer: null,
    yaw: 1,
    pitch: 0.2,
    targetDistance: 6.5,
    automaticHeading: null,
    companionView: null,
    manualInputAllowed: () => true,
    manualCameraAllowed: () => !automatic,
    companionViewTargets: () => [],
    rotateCamera: WorldRenderer.prototype.rotateCamera,
  };
  WorldRenderer.prototype.setupInput.call(camera);
  const drag = () => {
    const event = { button: 0, pointerId: 1, clientX: 20, clientY: 20, preventDefault() {} };
    camera.down(event);
    camera.move({ ...event, clientX: 80, clientY: 40 });
    camera.up(event);
    camera.wheel({ deltaY: 100, preventDefault() {} });
  };
  drag();
  assert.deepEqual([camera.yaw, camera.pitch, camera.targetDistance], [1, 0.2, 6.5]);
  automatic = false;
  drag();
  assert.ok(camera.yaw < 1 && camera.pitch > 0.2 && camera.targetDistance > 6.5);
});

test('beginner cues omit closeups and camera controls, including a previous closeup state', () => {
  for (const viewing of [false, true])
    for (const pad of [false, true]) {
      const cues = contextCues({ automaticCamera: true, viewing, inspect: '524', jump: true }, pad);
      assert.ok(
        cues.every((c) => !['inspect', 'zoomIn', 'zoomOut', 'endInspect'].includes(c.action)),
      );
      assert.ok(cues.some((c) => c.action === 'jump'));
    }
  assert.ok(contextCues({ inspect: '524' }, false).some((c) => c.action === 'inspect'));
});
