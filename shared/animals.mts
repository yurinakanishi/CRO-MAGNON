import { SCENERY } from './scenery-layout.mjs';
import { MODEL_BOUNDS } from './model-bounds.mjs';
import { movePlayer } from './movement.mjs';
import { animalIsSolid, initialHuntState, stopActor } from './hunting.mjs';
import { enemyIsSolid } from './combat.mjs';
import { updateRiddenAnimal } from './riding.mjs';

export const animalRadius = (scale) => MODEL_BOUNDS['woolly-mammoth'].radius * scale + 0.08;
export const actorObstacle = (actor) => ({
  id: actor.id,
  type: 'circle',
  x: actor.x,
  z: actor.z,
  radius: actor.radius,
});
export function createAnimals(collision, now = Date.now()) {
  const animals = [];
  for (const [index, item] of SCENERY.animals.entries()) {
    const radius = animalRadius(item.scale),
      position = collision.nearestFree(item, radius, animals.map(actorObstacle), 12);
    if (!position) throw new Error(`No collision-free spawn for ${item.id}`);
    animals.push({
      ...item,
      ...position,
      home: { ...position },
      ...initialHuntState(now),
      radius,
      facing: 0,
      speed: 0,
      moving: false,
      running: false,
      runningRequested: false,
      dx: 0,
      dz: 0,
      lastInput: 0,
      path: [],
      target: null,
      age: index * 13,
      roamIndex: index * 3,
      nextRoam: 0,
      blockedFor: 0,
      clip: 'Idle_Loop',
    });
  }
  return animals;
}
export function updateAnimals(room, dt, now = Date.now()) {
  for (const animal of room.animals) {
    animal.age += dt;
    if (animal.phase !== 'alive') {
      stopActor(animal);
      animal.clip = animal.phase === 'dying' ? 'Death' : null;
      continue;
    }
    if (updateRiddenAnimal(room, animal, dt, now)) continue;
    if (now < animal.hitUntil) {
      stopActor(animal);
      animal.clip = 'Idle_Loop';
      continue;
    }
    const grazing = animal.age % 38 > 27;
    const dynamic = [
      ...room.players.values(),
      ...room.animals.filter((a) => a !== animal && animalIsSolid(a)),
      ...(room.enemies || []).filter(enemyIsSolid),
    ].map(actorObstacle);
    if (grazing) {
      animal.speed = 0;
      animal.moving = false;
      animal.clip = 'Graze_Loop';
      continue;
    }
    if (!animal.target && !animal.path.length && animal.age >= animal.nextRoam) {
      const angle = ++animal.roamIndex * 2.39996;
      const goal = {
        x: animal.home.x + Math.sin(angle) * animal.roamRadius,
        z: animal.home.z + Math.cos(angle) * animal.roamRadius,
      };
      animal.path = room.collision.path(animal, goal, animal.radius);
      animal.nextRoam = animal.age + 4;
    }
    if (!animal.target) animal.target = animal.path.shift() || null;
    // Use the same swept collision solver as players, with a body-sized radius.
    const targetSpeed = 0.3541667 * animal.scale;
    movePlayer(
      animal,
      dt,
      Infinity,
      (p, dx, dz) => room.collision.move(p, dx, dz, animal.radius, dynamic),
      targetSpeed,
    );
    animal.blockedFor = animal.target && !animal.moving ? animal.blockedFor + dt : 0;
    if (animal.blockedFor > 2) {
      animal.target = null;
      animal.path = [];
      animal.nextRoam = animal.age + 1;
      animal.blockedFor = 0;
    }
    animal.clip = animal.moving ? 'Walk_Loop' : 'Idle_Loop';
  }
}
