/**
 * THE MAKO - level definition for "Among Us: Night Shift".
 *
 * Pure data. Used by the simulation (server side and offline client side) and by
 * the renderer to build geometry, lights, props, task and vent positions.
 *
 * Coordinate system: X to the right, Z downwards (top-down view), Y is up.
 * 1 unit = 1 metre.
 *
 * Layout: a ring corridor surrounds the central reactor; rooms hang off the ring
 * on both sides plus one room north (Security) and one south (Engine Room).
 */

export const ROOMS = [
  { id: 'security',   name: 'Security',    rect: [34, 4, 16, 16],  floor: '#232b3a', accent: '#2b3a55' },
  { id: 'electrical', name: 'Electrical',  rect: [4, 20, 22, 10],  floor: '#1f3030', accent: '#2a4a4a' },
  { id: 'navigation', name: 'Navigation',  rect: [58, 20, 22, 10], floor: '#28243a', accent: '#3a3350' },
  { id: 'cafeteria',  name: 'Cafeteria',   rect: [4, 30, 22, 16],  floor: '#33291f', accent: '#4a3a2a' },
  { id: 'reactor',    name: 'Reactor',     rect: [34, 30, 16, 16], floor: '#2e2222', accent: '#4a2a2a' },
  { id: 'medbay',     name: 'MedBay',      rect: [58, 30, 22, 16], floor: '#222d3a', accent: '#2a3a4a' },
  { id: 'weapons',    name: 'Weapons',     rect: [4, 46, 22, 10],  floor: '#2d2a20', accent: '#403a2a' },
  { id: 'engine',     name: 'Engine Room', rect: [34, 56, 16, 16], floor: '#2a241a', accent: '#3a3020' },
  { id: 'storage',    name: 'Storage',     rect: [58, 46, 22, 10], floor: '#212121', accent: '#2a2a2a' },
];

/** Ring corridors surrounding the reactor (x 26..58 / z 20..56). */
export const CORRIDORS = [
  { id: 'c_north', rect: [26, 20, 32, 10] },
  { id: 'c_south', rect: [26, 46, 32, 10] },
  { id: 'c_west',  rect: [26, 30, 8, 16] },
  { id: 'c_east',  rect: [50, 30, 8, 16] },
];

/**
 * Doorways cut into the wall of a room.
 * `side`: north(-z) | south(+z) | west(-x) | east(+x); `at` is the world
 * coordinate of the opening centre along that side.
 */
export const DOORS = [
  { room: 'security',   side: 'south', at: 42, width: 2.6 },
  { room: 'electrical', side: 'east',  at: 25, width: 2.6 },
  { room: 'navigation', side: 'west',  at: 25, width: 2.6 },
  { room: 'cafeteria',  side: 'east',  at: 38, width: 2.8 },
  { room: 'reactor',    side: 'north', at: 42, width: 2.8 },
  { room: 'reactor',    side: 'south', at: 42, width: 2.8 },
  { room: 'reactor',    side: 'west',  at: 38, width: 2.8 },
  { room: 'reactor',    side: 'east',  at: 38, width: 2.8 },
  { room: 'medbay',     side: 'west',  at: 38, width: 2.8 },
  { room: 'weapons',    side: 'east',  at: 51, width: 2.6 },
  { room: 'engine',     side: 'north', at: 42, width: 2.6 },
  { room: 'storage',    side: 'west',  at: 51, width: 2.6 },
];

/** Vent network: each vent belongs to a room; links describe crawl routes. */
export const VENTS = [
  { id: 'v_elec_a', pos: [7, 0, 22.5],  room: 'electrical' },
  { id: 'v_elec_b', pos: [23, 0, 28],   room: 'electrical' },
  { id: 'v_nav_a',  pos: [77, 0, 22.5], room: 'navigation' },
  { id: 'v_nav_b',  pos: [61, 0, 28],   room: 'navigation' },
  { id: 'v_sec_a',  pos: [36, 0, 6.5],  room: 'security' },
  { id: 'v_sec_b',  pos: [48, 0, 6.5],  room: 'security' },
  { id: 'v_caf_a',  pos: [7, 0, 43.5],  room: 'cafeteria' },
  { id: 'v_caf_b',  pos: [23, 0, 32],   room: 'cafeteria' },
  { id: 'v_reac_a', pos: [36, 0, 32],   room: 'reactor' },
  { id: 'v_reac_b', pos: [48, 0, 44],   room: 'reactor' },
  { id: 'v_med_a',  pos: [77, 0, 32],   room: 'medbay' },
  { id: 'v_med_b',  pos: [61, 0, 43.5], room: 'medbay' },
  { id: 'v_wep_a',  pos: [7, 0, 53.5],  room: 'weapons' },
  { id: 'v_eng_a',  pos: [36, 0, 69.5], room: 'engine' },
  { id: 'v_sto_a',  pos: [77, 0, 53.5], room: 'storage' },
  { id: 'v_sto_b',  pos: [61, 0, 48.5], room: 'storage' },
];

/** Vent crawl routes (undirected). */
export const VENT_LINKS = [
  ['v_elec_a', 'v_elec_b'], ['v_elec_b', 'v_sec_a'], ['v_sec_a', 'v_sec_b'],
  ['v_sec_b', 'v_nav_a'], ['v_nav_a', 'v_nav_b'], ['v_nav_b', 'v_caf_b'],
  ['v_caf_b', 'v_caf_a'], ['v_caf_a', 'v_reac_a'], ['v_reac_a', 'v_reac_b'],
  ['v_reac_b', 'v_med_b'], ['v_med_b', 'v_med_a'], ['v_med_a', 'v_sto_b'],
  ['v_sto_b', 'v_sto_a'], ['v_sto_a', 'v_eng_a'], ['v_eng_a', 'v_wep_a'],
  ['v_wep_a', 'v_elec_a'],
];

/**
 * Tasks. `pos` is where the player stands, `console` is where the console prop
 * is placed (the renderer creates one console model per task automatically).
 */
export const TASKS = [
  { id: 't_wires_1',  type: 'wires',  room: 'electrical', pos: [10, 0, 24],   console: [10, 0, 20.6],  label: 'Calibrate Wiring' },
  { id: 't_wires_2',  type: 'wires',  room: 'electrical', pos: [16, 0, 24],   console: [16, 0, 20.6],  label: 'Calibrate Wiring' },
  { id: 't_divert_1', type: 'divert', room: 'electrical', pos: [22, 0, 24],   console: [22, 0, 20.6],  label: 'Divert Power' },
  { id: 't_scan_1',   type: 'scan',   room: 'security',   pos: [42, 0, 8],    console: [42, 0, 4.6],   label: 'Calibrate Distortion' },
  { id: 't_upload_1', type: 'upload', room: 'navigation', pos: [64, 0, 25],   console: [64, 0, 20.6],  label: 'Upload Data' },
  { id: 't_empty_1',  type: 'empty',  room: 'cafeteria',  pos: [8, 0, 32],    console: [8, 0, 30.6],   label: 'Empty Garbage' },
  { id: 't_upload_2', type: 'upload', room: 'cafeteria',  pos: [20, 0, 43],   console: [20, 0, 45.4],  label: 'Upload Data' },
  { id: 't_start_1',  type: 'start',  room: 'reactor',    pos: [38, 0, 34],   console: [38, 0, 30.6],  label: 'Start Reactor' },
  { id: 't_unlock_1', type: 'unlock', room: 'reactor',    pos: [46, 0, 42],   console: [46, 0, 45.4],  label: 'Unlock Manifolds' },
  { id: 't_scan_2',   type: 'scan',   room: 'medbay',     pos: [72, 0, 32],   console: [72, 0, 30.6],  label: 'Submit Scan' },
  { id: 't_upload_3', type: 'upload', room: 'medbay',     pos: [62, 0, 43],   console: [62, 0, 45.4],  label: 'Upload Data' },
  { id: 't_divert_2', type: 'divert', room: 'weapons',    pos: [9, 0, 51],    console: [9, 0, 46.6],   label: 'Divert Power' },
  { id: 't_fuel_1',   type: 'fuel',   room: 'weapons',    pos: [20, 0, 51],   console: [20, 0, 46.6],  label: 'Refuel' },
  { id: 't_empty_2',  type: 'empty',  room: 'engine',     pos: [38, 0, 60],   console: [38, 0, 56.6],  label: 'Empty Garbage' },
  { id: 't_fuel_2',   type: 'fuel',   room: 'engine',     pos: [46, 0, 70],   console: [46, 0, 71.4],  label: 'Refuel' },
  { id: 't_empty_3',  type: 'empty',  room: 'storage',    pos: [62, 0, 51],   console: [62, 0, 46.6],  label: 'Empty Garbage' },
  { id: 't_fuel_3',   type: 'fuel',   room: 'storage',    pos: [74, 0, 51],   console: [74, 0, 46.6],  label: 'Refuel' },
  { id: 't_scan_3',   type: 'scan',   room: 'storage',    pos: [68, 0, 51],   console: [68, 0, 46.6],  label: 'Submit Scan' },
];

/** Spawn points (players are distributed round-robin). */
export const SPAWNS = [
  { pos: [14, 0, 38], room: 'cafeteria' },
  { pos: [42, 0, 38], room: 'reactor' },
  { pos: [70, 0, 38], room: 'medbay' },
  { pos: [14, 0, 25], room: 'electrical' },
  { pos: [68, 0, 25], room: 'navigation' },
  { pos: [42, 0, 10], room: 'security' },
  { pos: [14, 0, 51], room: 'weapons' },
  { pos: [42, 0, 66], room: 'engine' },
  { pos: [68, 0, 51], room: 'storage' },
  { pos: [42, 0, 25], room: 'c_north' },
  { pos: [30, 0, 38], room: 'c_west' },
  { pos: [54, 0, 38], room: 'c_east' },
];

/** Emergency button in the cafeteria. */
export const EMERGENCY_BUTTON = { pos: [6.5, 0, 43.5], room: 'cafeteria' };

/** Material palette. */
export const PALETTE = {
  wall: '#3b4250',
  wallDark: '#2b303b',
  ceiling: '#232833',
  floor: '#2a2f3a',
  trim: '#c47a20',
  metal: '#6b7280',
};

export const WALL_HEIGHT = 3.4;
export const CORRIDOR_HEIGHT = 3.0;

/** Prop placements: { model, pos, rotY, scale }. Consoles are generated from TASKS. */
export const PROPS = [
  // Cafeteria
  { model: 'table', pos: [10, 0, 34], rotY: 0 },
  { model: 'table', pos: [16, 0, 34], rotY: 0 },
  { model: 'table', pos: [10, 0, 41], rotY: 0 },
  { model: 'table', pos: [16, 0, 41], rotY: 0 },
  { model: 'chair', pos: [10, 0, 31.8], rotY: Math.PI },
  { model: 'chair', pos: [10, 0, 36.2], rotY: 0 },
  { model: 'chair', pos: [16, 0, 31.8], rotY: Math.PI },
  { model: 'chair', pos: [16, 0, 36.2], rotY: 0 },
  { model: 'chair', pos: [10, 0, 43.2], rotY: Math.PI },
  { model: 'chair', pos: [16, 0, 43.2], rotY: Math.PI },
  { model: 'plant', pos: [5.5, 0, 31] },
  { model: 'plant', pos: [24.5, 0, 44.5] },
  { model: 'barrel', pos: [24, 0, 33.5] },
  { model: 'barrel', pos: [24.6, 0, 34.6] },
  // Reactor
  { model: 'reactor', pos: [42, 0, 38] },
  { model: 'crate', pos: [35.6, 0, 31.8], rotY: 0.4 },
  { model: 'crate', pos: [35.4, 0, 33.4], rotY: -0.2 },
  { model: 'pipe_set', pos: [42, 2.5, 45.4], rotY: 0 },
  { model: 'pipe_set', pos: [42, 2.5, 30.6], rotY: Math.PI },
  { model: 'medkit', pos: [34.9, 0, 44], rotY: Math.PI / 2 },
  // Electrical
  { model: 'server_rack', pos: [4.9, 0, 23], rotY: Math.PI / 2 },
  { model: 'server_rack', pos: [4.9, 0, 24.6], rotY: Math.PI / 2 },
  { model: 'server_rack', pos: [4.9, 0, 27.6], rotY: Math.PI / 2 },
  { model: 'crate', pos: [24, 0, 28.4], rotY: 0.3 },
  { model: 'barrel', pos: [23, 0, 21.6] },
  // Navigation
  { model: 'table', pos: [74, 0, 26], rotY: 0.4 },
  { model: 'chair', pos: [74, 0, 24.4], rotY: Math.PI },
  { model: 'sign', pos: [58, 2.2, 25], rotY: -Math.PI / 2 },
  { model: 'crate', pos: [78, 0, 21.5], rotY: -0.3 },
  // Security
  { model: 'table', pos: [46, 0, 16], rotY: 0 },
  { model: 'chair', pos: [46, 0, 14.4], rotY: Math.PI },
  { model: 'server_rack', pos: [34.9, 0, 6], rotY: Math.PI / 2 },
  { model: 'crate', pos: [48.5, 0, 18], rotY: -0.3 },
  { model: 'sign', pos: [42, 2.2, 19.6], rotY: 0 },
  // MedBay
  { model: 'medkit', pos: [59, 0, 44.5], rotY: 0 },
  { model: 'plant', pos: [78.5, 0, 44.5] },
  { model: 'server_rack', pos: [79.2, 0, 38], rotY: -Math.PI / 2 },
  // Weapons
  { model: 'crate', pos: [24, 0, 48.5], rotY: 0.2 },
  { model: 'crate', pos: [24, 0, 50.7], rotY: -0.4 },
  { model: 'barrel', pos: [5.5, 0, 49] },
  { model: 'barrel', pos: [6.3, 0, 50.1] },
  // Engine
  { model: 'reactor', pos: [42, 0, 66], scale: 0.55 },
  { model: 'pipe_set', pos: [42, 2.5, 57.2], rotY: 0 },
  { model: 'barrel', pos: [35.4, 0, 63.5] },
  { model: 'barrel', pos: [35.1, 0, 64.7] },
  { model: 'crate', pos: [48.4, 0, 70], rotY: 0.25 },
  // Storage
  { model: 'crate', pos: [60, 0, 47.6], rotY: 0.15 },
  { model: 'crate', pos: [62.2, 0, 47.8], rotY: -0.3 },
  { model: 'crate', pos: [61, 0, 50], rotY: 0.5 },
  { model: 'barrel', pos: [69, 0, 54.5] },
  { model: 'barrel', pos: [69.7, 0, 53.5] },
  // Corridors
  { model: 'pipe_set', pos: [30, 2.4, 26], rotY: Math.PI / 2 },
  { model: 'pipe_set', pos: [54, 2.4, 26], rotY: Math.PI / 2 },
  { model: 'pipe_set', pos: [30, 2.4, 50], rotY: Math.PI / 2 },
  { model: 'pipe_set', pos: [54, 2.4, 50], rotY: Math.PI / 2 },
  { model: 'crate', pos: [28.4, 0, 42], rotY: 0.2 },
  { model: 'crate', pos: [55.6, 0, 44], rotY: -0.2 },
  { model: 'sign', pos: [42, 2.2, 20.4], rotY: 0 },
  { model: 'sign', pos: [42, 2.2, 55.6], rotY: Math.PI },
];

/** Lights: fluorescent fixtures with optional flicker. */
export const LIGHTS = [
  { pos: [10, 3.0, 25], color: 0xbfe4ff, intensity: 1.5, range: 13, flicker: 0.05 },
  { pos: [21, 3.0, 25], color: 0xbfe4ff, intensity: 1.1, range: 11, flicker: 0.12 },
  { pos: [10, 3.0, 38], color: 0xffd9a8, intensity: 1.6, range: 14, flicker: 0.03 },
  { pos: [20, 3.0, 40], color: 0xffd9a8, intensity: 1.2, range: 12, flicker: 0.08 },
  { pos: [42, 3.0, 38], color: 0xff9a70, intensity: 1.9, range: 16, flicker: 0.16 },
  { pos: [37, 3.0, 32], color: 0xffb27a, intensity: 1.1, range: 12, flicker: 0.10 },
  { pos: [70, 3.0, 38], color: 0xcfe8ff, intensity: 1.5, range: 14, flicker: 0.04 },
  { pos: [63, 3.0, 40], color: 0xcfe8ff, intensity: 1.1, range: 12, flicker: 0.09 },
  { pos: [64, 3.0, 25], color: 0x9fd0ff, intensity: 1.3, range: 13, flicker: 0.07 },
  { pos: [76, 3.0, 25], color: 0x9fd0ff, intensity: 1.0, range: 11, flicker: 0.14 },
  { pos: [39, 3.0, 9], color: 0x8fe0c0, intensity: 1.2, range: 12, flicker: 0.06 },
  { pos: [46, 3.0, 13], color: 0x8fe0c0, intensity: 0.9, range: 10, flicker: 0.11 },
  { pos: [10, 3.0, 51], color: 0xffc27a, intensity: 1.4, range: 13, flicker: 0.05 },
  { pos: [21, 3.0, 51], color: 0xffc27a, intensity: 1.0, range: 11, flicker: 0.12 },
  { pos: [42, 3.0, 64], color: 0xffa050, intensity: 1.6, range: 15, flicker: 0.14 },
  { pos: [38, 3.0, 69], color: 0xffa050, intensity: 1.0, range: 11, flicker: 0.10 },
  { pos: [66, 3.0, 51], color: 0xbfbfd0, intensity: 1.2, range: 13, flicker: 0.10 },
  { pos: [75, 3.0, 51], color: 0xbfbfd0, intensity: 0.9, range: 11, flicker: 0.06 },
  // corridor lights
  { pos: [32, 2.8, 25], color: 0xa8c8e8, intensity: 0.95, range: 11, flicker: 0.13 },
  { pos: [52, 2.8, 25], color: 0xa8c8e8, intensity: 0.95, range: 11, flicker: 0.09 },
  { pos: [30, 2.8, 38], color: 0xa8c8e8, intensity: 0.9, range: 11, flicker: 0.15 },
  { pos: [54, 2.8, 38], color: 0xa8c8e8, intensity: 0.9, range: 11, flicker: 0.07 },
  { pos: [32, 2.8, 51], color: 0xa8c8e8, intensity: 0.95, range: 11, flicker: 0.11 },
  { pos: [52, 2.8, 51], color: 0xa8c8e8, intensity: 0.95, range: 11, flicker: 0.06 },
  { pos: [40, 2.8, 51], color: 0xa8c8e8, intensity: 0.85, range: 11, flicker: 0.14 },
  { pos: [44, 2.8, 51], color: 0xa8c8e8, intensity: 0.85, range: 11, flicker: 0.08 },
];

/** Ambient light + fog (kept low for a horror look). */
export const AMBIENT = { color: 0x161c2a, intensity: 0.32, fog: 0x090c12, fogNear: 5, fogFar: 40 };

export const PLAYER_COLORS = [
  '#c51111', '#132ed1', '#117f2d', '#ed54ba', '#ef7d0d', '#6f2fc4',
  '#3f72ec', '#e4b800', '#117089', '#b5b0a8', '#8b5a2b', '#4d6b3c',
];

export const PLAYER_NAMES = [
  'Nova', 'Vex', 'Juno', 'Orion', 'Kira', 'Rex', 'Lyra', 'Cyan', 'Dax', 'Sable',
  'Pike', 'Echo', 'Frost', 'Halo', 'Zephyr', 'Mako',
];
