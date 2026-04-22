/**
 * Integration façades — one import surface for every external-service
 * UI call. Each wrapper is a thin typed front-end over the sidecar
 * admin-api (`sidecarProxy` CF → sidecar `/admin-api/*`). The sidecar
 * decides sim vs real based on `system/settings.simulationMode`.
 *
 * Callers don't pass a `simulated` flag and don't see sim-specific
 * logic. The one exception is live Firestore subscriptions (faxes
 * inbox, SMS history) — those can't be routed through a callable, so
 * the subscribing component still reads `useSimulationMode()` to pick
 * the collection path.
 *
 * Detach recipe for a customer fork: see `docs/SIMULATION.md`.
 */

export * as drchrono from './drchrono';
export * as faxes from './faxes';
export * as sms from './sms';
