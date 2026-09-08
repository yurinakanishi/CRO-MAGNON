const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function planNavigation(actor, goal, collision, dynamic, now = Date.now()) {
  actor.navigationGoal = { x: goal.x, z: goal.z };
  actor.navigationEnd = null;
  actor.target = null;
  actor.path = [];
  actor.nextNavigationAt = 0;
  return updateNavigation(actor, collision, dynamic, now);
}

export function updateNavigation(actor, collision, dynamic, now = Date.now()) {
  if (!actor.navigationGoal) return false;
  if (!actor.target) actor.target = actor.path.shift() || null;
  if (!actor.target && actor.navigationEnd && distance(actor, actor.navigationEnd) < 0.015) {
    actor.navigationGoal = null;
    actor.navigationEnd = null;
    return false;
  }
  if (now < actor.nextNavigationAt) return !!actor.target;
  if (actor.target && collision.segmentFree(actor, actor.target, actor.radius, dynamic))
    return true;
  // Keep the requested goal when a temporary crowd closes every route. Retry
  // at most twice per second and keep the normal collision solver authoritative.
  actor.nextNavigationAt = now + 500;
  actor.path = collision.path(actor, actor.navigationGoal, actor.radius, dynamic);
  actor.navigationEnd = actor.path.at(-1) || null;
  actor.target = actor.path.shift() || null;
  return !!actor.target;
}
