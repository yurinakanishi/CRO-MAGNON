import { SCENERY } from './scenery-layout.mjs';
import { MODEL_BOUNDS } from './model-bounds.mjs';
import { moveActor } from './movement.mjs';
import { animalIsSolid, initialHuntState, stopActor } from './hunting.mjs';
import { enemyIsSolid } from './combat.mjs';
import { updateRiddenAnimal } from './riding.mjs';
import { mammothNavigation } from './mammoth-navigation.mjs';

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
  const navigation = mammothNavigation(collision);
  for (const [index, item] of SCENERY.animals.entries()) {
    const radius = animalRadius(item.scale),
      position = navigation.nearestFree(item, radius, animals.map(actorObstacle), 12);
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
/** Recover old saves that left a living mammoth or its home on unsafe ground. */
export function restoreAnimalGround(room, animal, safePost) {
  const navigation = mammothNavigation(room.collision);
  if (!navigation.free(animal.home, animal.radius)) animal.home = { ...safePost };
  if (animal.phase !== 'alive' || navigation.free(animal, animal.radius)) return;
  const dynamic = room.animals
    .filter((other) => other !== animal && animalIsSolid(other))
    .map(actorObstacle);
  const point = navigation.nearestFree(animal.home, animal.radius, dynamic, animal.roamRadius);
  if (!point) throw new Error(`No safe ground to restore ${animal.id}`);
  Object.assign(animal, point);
  animal.home = { ...point };
  stopActor(animal);
  animal.nextRoam = animal.age + 1;
}
export function updateAnimals(room, dt, now = Date.now()) {
  const navigation = mammothNavigation(room.collision);
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
      ...(room.residents || []),
    ].map(actorObstacle);
    if (grazing) {
      animal.speed = 0;
      animal.moving = false;
      animal.clip = 'Graze_Loop';
      continue;
    }
    if (!animal.target && !animal.path.length && animal.age >= animal.nextRoam) {
      const angle = ++animal.roamIndex * 2.39996;
      // Shorten a grazing step before a cliff. Generic pathfinding may move an
      // unsafe goal beyond the pasture, so select a safe goal here first.
      for (const fraction of [1, 0.75, 0.5]) {
        const goal = {
          x: animal.home.x + Math.sin(angle) * animal.roamRadius * fraction,
          z: animal.home.z + Math.cos(angle) * animal.roamRadius * fraction,
        };
        if (!navigation.free(goal, animal.radius)) continue;
        const path = navigation.path(animal, goal, animal.radius);
        if (
          path.length &&
          path.every(
            (p) => Math.hypot(p.x - animal.home.x, p.z - animal.home.z) <= animal.roamRadius + 0.01,
          )
        ) {
          animal.path = path;
          break;
        }
      }
      animal.nextRoam = animal.age + 4;
    }
    if (!animal.target) animal.target = animal.path.shift() || null;
    // Use the same swept collision solver as players, with a body-sized radius.
    const targetSpeed = 0.3541667 * animal.scale;
    moveActor(
      animal,
      dt,
      Infinity,
      (p, dx, dz) => navigation.move(p, dx, dz, animal.radius, dynamic),
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
