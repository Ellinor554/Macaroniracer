/**
 * Macaroni Racer 3D  –  game.js
 *
 * A 3D kids racing game: macaroni characters in cars race
 * through see-through tube tracks, powered by Three.js.
 */

/* ============================================================
   Constants & Configuration
   ============================================================ */
const TUBE_RADIUS      = 7;       // radius of the race tube
const CAR_LANE_MAX     = TUBE_RADIUS - 2.2; // max lateral offset inside tube
const TOTAL_LAPS       = 3;
const NUM_AI           = 3;
const CURVE_SEGMENTS   = 300;     // resolution of the track spline

const MAX_SPEED        = 0.0018;  // max forward progress per frame
const ACCEL            = 0.000025;
const DECEL            = 0.000015;
const BRAKE_DECEL      = 0.00006;
const STEER_SPEED      = 0.04;    // lateral movement per frame
const STEER_RETURN     = 0.015;   // auto-center rate

// Racer configurations
const RACER_CONFIG = [
  { name: 'You',      color: 0xff4444, isPlayer: true,  baseSpeed: 0.00135, speedVar: 0 },
  { name: 'Rigatoni', color: 0x44ccff, isPlayer: false, baseSpeed: 0.00118, speedVar: 0.00015 },
  { name: 'Fusilli',  color: 0x44ff88, isPlayer: false, baseSpeed: 0.00128, speedVar: 0.0001  },
  { name: 'Penne',    color: 0xffaa33, isPlayer: false, baseSpeed: 0.00122, speedVar: 0.00012 },
];

// Ordinal labels for positions
const ORDINALS = ['1st 🥇', '2nd 🥈', '3rd 🥉', '4th'];

/* ============================================================
   Global state
   ============================================================ */
let gameState = 'start';  // 'start' | 'countdown' | 'racing' | 'finished'
const keys    = {};       // currently pressed keys
let animId    = null;

/* ============================================================
   Three.js setup
   ============================================================ */
const canvas   = document.getElementById('gameCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x05000f);
scene.fog        = new THREE.FogExp2(0x05000f, 0.006);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 800);

/* ── resize handler ──────────────────────────────────────── */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ============================================================
   Lighting
   ============================================================ */
function setupLights() {
  const ambient = new THREE.AmbientLight(0x6644aa, 0.6);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(60, 100, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  // Coloured point lights along the tube for atmosphere
  const lightColors = [0x0088ff, 0xff4488, 0x00ffcc, 0xffaa00];
  lightColors.forEach((c, i) => {
    const pl = new THREE.PointLight(c, 2.5, 80);
    const angle = (i / lightColors.length) * Math.PI * 2;
    pl.position.set(Math.cos(angle) * 35, 10, Math.sin(angle) * 35);
    scene.add(pl);
  });
}

/* ============================================================
   Track
   ============================================================ */
let trackCurve;
let trackFrames;

function buildTrackCurve() {
  // A fun winding loop through 3D space
  const pts = [];
  const N   = 16;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const r = 38 + Math.cos(t * 2.5) * 10;
    pts.push(new THREE.Vector3(
      Math.cos(t) * r,
      Math.sin(t * 1.8) * 14,
      Math.sin(t) * r
    ));
  }
  trackCurve  = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
  trackFrames = trackCurve.computeFrenetFrames(CURVE_SEGMENTS, true);
}

function buildTrack() {
  buildTrackCurve();

  // ── Outer transparent tube (the see-through tunnel) ──────
  const tubeGeo  = new THREE.TubeGeometry(trackCurve, CURVE_SEGMENTS, TUBE_RADIUS, 24, true);
  const tubeMat  = new THREE.MeshPhongMaterial({
    color:       0x33aaff,
    emissive:    0x001133,
    transparent: true,
    opacity:     0.13,
    side:        THREE.BackSide,
    depthWrite:  false,
  });
  scene.add(new THREE.Mesh(tubeGeo, tubeMat));

  // ── Outer shell (faint rim) ───────────────────────────────
  const rimMat = new THREE.MeshPhongMaterial({
    color:       0x88ddff,
    emissive:    0x002244,
    transparent: true,
    opacity:     0.06,
    side:        THREE.FrontSide,
    depthWrite:  false,
  });
  scene.add(new THREE.Mesh(tubeGeo, rimMat));

  // ── Wireframe grid overlay ───────────────────────────────
  const wireMat = new THREE.MeshBasicMaterial({
    color:       0x55ccff,
    wireframe:   true,
    transparent: true,
    opacity:     0.22,
  });
  scene.add(new THREE.Mesh(
    new THREE.TubeGeometry(trackCurve, CURVE_SEGMENTS, TUBE_RADIUS, 18, true),
    wireMat
  ));

  // ── Floor strip inside tube ──────────────────────────────
  buildTrackFloor();

  // ── Decorative ring gates ────────────────────────────────
  buildRingGates();

  // ── Floating star particles ──────────────────────────────
  buildStars();
}

function buildTrackFloor() {
  // A narrow glowing ribbon along the bottom of the tube as a "road"
  const pathPts  = trackCurve.getPoints(CURVE_SEGMENTS);
  const normals  = trackFrames.normals;
  const binormals = trackFrames.binormals;

  const vertices = [];
  const width    = 5;

  for (let i = 0; i <= CURVE_SEGMENTS; i++) {
    const idx = i % CURVE_SEGMENTS;
    const p   = pathPts[idx];
    const n   = normals[idx];
    const b   = binormals[idx];

    // "Down" in tube = -normal rotated to point inward; approximate with -n
    // Offset toward the bottom of the tube interior
    const floor = p.clone()
      .addScaledVector(n, -(TUBE_RADIUS - 0.3));

    const left  = floor.clone().addScaledVector(b, -width / 2);
    const right = floor.clone().addScaledVector(b,  width / 2);

    vertices.push(left.x, left.y, left.z, right.x, right.y, right.z);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

  // Build index for a strip
  const indices = [];
  for (let i = 0; i < CURVE_SEGMENTS; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    indices.push(a, b, c,  b, d, c);
  }
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshBasicMaterial({
    color:       0x1155ff,
    transparent: true,
    opacity:     0.35,
    side:        THREE.DoubleSide,
    depthWrite:  false,
  });
  scene.add(new THREE.Mesh(geo, mat));
}

function buildRingGates() {
  const ringMat = new THREE.MeshPhongMaterial({
    color:    0xffdd57,
    emissive: 0x886600,
  });

  const N = 12;
  for (let i = 0; i < N; i++) {
    const t     = i / N;
    const pt    = trackCurve.getPoint(t);
    const tangent = trackCurve.getTangent(t);

    const ringGeo  = new THREE.TorusGeometry(TUBE_RADIUS + 0.5, 0.3, 8, 32);
    const ringMesh = new THREE.Mesh(ringGeo, ringMat.clone());

    // Orient ring perpendicular to track tangent
    ringMesh.position.copy(pt);
    ringMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent.normalize());
    scene.add(ringMesh);
  }
}

function buildStars() {
  const starGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(3000);
  for (let i = 0; i < positions.length; i++) {
    positions[i] = (Math.random() - 0.5) * 400;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size:  0.6,
    sizeAttenuation: true,
  });
  scene.add(new THREE.Points(starGeo, starMat));
}

/* ============================================================
   Macaroni-Car Mesh
   ============================================================ */
function createMacaroniCar(color) {
  const group = new THREE.Group();

  // ── Car body ─────────────────────────────────────────────
  const bodyGeo = new THREE.BoxGeometry(1.2, 0.5, 2.0);
  const bodyMat = new THREE.MeshPhongMaterial({ color, shininess: 90 });
  const body    = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.25;
  body.castShadow = true;
  group.add(body);

  // ── Cabin (smaller box on top) ───────────────────────────
  const cabinGeo = new THREE.BoxGeometry(0.9, 0.4, 0.95);
  const cabinMat = new THREE.MeshPhongMaterial({
    color:       0xaaddff,
    transparent: true,
    opacity:     0.6,
    shininess:   120,
  });
  const cabin = new THREE.Mesh(cabinGeo, cabinMat);
  cabin.position.set(0, 0.7, -0.1);
  group.add(cabin);

  // ── Macaroni (elbow pasta) on the roof ───────────────────
  // Represented as a half-torus arc (elbow shape)
  const macaroniCurve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-0.35, 0,  0),
    new THREE.Vector3(0,     0.4, 0),
    new THREE.Vector3( 0.35, 0,  0)
  );
  const macaroniGeo = new THREE.TubeGeometry(macaroniCurve, 12, 0.11, 8, false);
  const macaroniMat = new THREE.MeshPhongMaterial({
    color:     0xf5d27a,   // pasta yellow
    shininess: 60,
  });
  const macaroni = new THREE.Mesh(macaroniGeo, macaroniMat);
  macaroni.position.set(0, 1.0, 0);
  macaroni.castShadow = true;
  group.add(macaroni);

  // ── Eyes on the macaroni ─────────────────────────────────
  const eyeGeo = new THREE.SphereGeometry(0.065, 8, 8);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  [-0.15, 0.15].forEach(x => {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(x, 1.38, 0.05);
    group.add(eye);
  });

  // ── Wheels ───────────────────────────────────────────────
  const wheelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.18, 16);
  const wheelMat = new THREE.MeshPhongMaterial({ color: 0x222222 });
  const hubGeo   = new THREE.CylinderGeometry(0.12, 0.12, 0.19, 8);
  const hubMat   = new THREE.MeshPhongMaterial({ color: 0xaaaaaa });

  [[-0.65, 0, 0.72], [0.65, 0, 0.72], [-0.65, 0, -0.72], [0.65, 0, -0.72]]
    .forEach(([x, y, z]) => {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, y, z);
      const hub = new THREE.Mesh(hubGeo, hubMat);
      hub.rotation.z = Math.PI / 2;
      hub.position.set(x, y, z);
      group.add(wheel);
      group.add(hub);
    });

  // ── Name tag above car ───────────────────────────────────
  // (a small colored sphere as a "flag")
  const flagGeo = new THREE.SphereGeometry(0.18, 8, 8);
  const flagMat = new THREE.MeshBasicMaterial({ color });
  const flag    = new THREE.Mesh(flagGeo, flagMat);
  flag.position.set(0, 1.85, 0);
  group.add(flag);

  group.castShadow = true;
  return group;
}

/* ============================================================
   Racer objects
   ============================================================ */
const racers = [];

function initRacers() {
  RACER_CONFIG.forEach((cfg, index) => {
    const mesh = createMacaroniCar(cfg.color);
    scene.add(mesh);

    racers.push({
      ...cfg,
      mesh,
      index,
      progress:    index * 0.015,   // stagger starts
      laneOffset:  0,                // lateral position in tube (-1…1)
      speed:       0,
      lapsDone:    0,
      finished:    false,
      finishPlace: 0,
      // exhaust particles
      particles:   buildExhaust(cfg.color),
    });
  });
}

/* ============================================================
   Exhaust particles
   ============================================================ */
function buildExhaust(color) {
  const geo = new THREE.BufferGeometry();
  const N   = 20;
  const pos = new Float32Array(N * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color,
    size:            0.25,
    transparent:     true,
    opacity:         0.55,
    sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  return { pts, pos, N, ages: new Float32Array(N).fill(-1) };
}

function updateExhaust(racer) {
  const { pts, pos, N, ages } = racer.particles;
  const carPos = racer.mesh.position;

  // Emit new particle
  let emitSlot = -1;
  for (let i = 0; i < N; i++) {
    if (ages[i] < 0) { emitSlot = i; break; }
  }
  if (emitSlot >= 0 && racer.speed > MAX_SPEED * 0.3) {
    pos[emitSlot * 3]     = carPos.x + (Math.random() - 0.5) * 0.4;
    pos[emitSlot * 3 + 1] = carPos.y + (Math.random() - 0.5) * 0.4;
    pos[emitSlot * 3 + 2] = carPos.z + (Math.random() - 0.5) * 0.4;
    ages[emitSlot] = 1.0;
  }

  // Age particles
  for (let i = 0; i < N; i++) {
    if (ages[i] >= 0) {
      ages[i] -= 0.06;
      if (ages[i] < 0) {
        pos[i * 3] = pos[i * 3 + 1] = pos[i * 3 + 2] = 9999;
      }
    }
  }

  pts.geometry.attributes.position.needsUpdate = true;
  pts.material.opacity = 0.4;
}

/* ============================================================
   Racer positioning along track
   ============================================================ */
function positionRacer(racer) {
  const t        = racer.progress % 1;
  const segIdx   = Math.min(Math.floor(t * CURVE_SEGMENTS), CURVE_SEGMENTS - 1);
  const pt       = trackCurve.getPoint(t);
  const tangent  = trackFrames.tangents[segIdx].clone();
  const normal   = trackFrames.normals[segIdx].clone();
  const binormal = trackFrames.binormals[segIdx].clone();

  // Place car at bottom of tube + lateral offset
  const laneVec  = binormal.clone().multiplyScalar(racer.laneOffset * CAR_LANE_MAX);
  const floorVec = normal.clone().multiplyScalar(-(TUBE_RADIUS - 1.6));

  const pos = pt.clone().add(laneVec).add(floorVec);
  racer.mesh.position.copy(pos);

  // Orient car: forward = tangent, up = toward tube centre
  const up     = pt.clone().sub(pos).normalize();   // inward normal
  const target = pos.clone().add(tangent);
  racer.mesh.up.copy(up);
  racer.mesh.lookAt(target);

  updateExhaust(racer);
}

/* ============================================================
   Player input
   ============================================================ */
document.addEventListener('keydown', e => { keys[e.code] = true; });
document.addEventListener('keyup',   e => { keys[e.code] = false; });

// Touch / swipe controls for mobile
(function setupTouch() {
  let startX = 0, startY = 0;
  canvas.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  canvas.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (Math.abs(dx) > 20) {
      keys['ArrowRight'] = dx > 0;
      keys['ArrowLeft']  = dx < 0;
    }
    if (Math.abs(dy) > 20) {
      keys['ArrowUp']   = dy < 0;
      keys['ArrowDown'] = dy > 0;
    }
  }, { passive: true });
  canvas.addEventListener('touchend', () => {
    keys['ArrowRight'] = keys['ArrowLeft'] = keys['ArrowUp'] = keys['ArrowDown'] = false;
  }, { passive: true });
}());

function updatePlayerInput(racer) {
  if (keys['ArrowUp'])   racer.speed = Math.min(racer.speed + ACCEL,       MAX_SPEED);
  if (keys['ArrowDown']) racer.speed = Math.max(racer.speed - BRAKE_DECEL, 0);
  if (!keys['ArrowUp'] && !keys['ArrowDown']) {
    // Coast (slow friction decel)
    if (racer.speed > racer.baseSpeed * 0.6) {
      racer.speed = Math.max(racer.speed - DECEL, racer.baseSpeed * 0.6);
    }
    if (racer.speed < racer.baseSpeed * 0.6) {
      racer.speed = Math.min(racer.speed + ACCEL * 0.5, racer.baseSpeed * 0.6);
    }
  }

  if (keys['ArrowLeft'])  racer.laneOffset = Math.max(racer.laneOffset - STEER_SPEED, -1);
  if (keys['ArrowRight']) racer.laneOffset = Math.min(racer.laneOffset + STEER_SPEED,  1);
  if (!keys['ArrowLeft'] && !keys['ArrowRight']) {
    racer.laneOffset *= (1 - STEER_RETURN);
  }
}

/* ============================================================
   AI driving
   ============================================================ */
function updateAI(racer, frameCount) {
  // Speed variation using a sine wave for each AI
  const noise  = Math.sin(frameCount * 0.01 + racer.index) * racer.speedVar;
  racer.speed  = racer.baseSpeed + noise;

  // Gentle lane weaving
  racer.laneOffset = Math.sin(frameCount * 0.008 + racer.index * 1.7) * 0.55;
}

/* ============================================================
   Lap counting
   ============================================================ */
let placesFinished = 0;

function checkLap(racer) {
  const raw = racer.progress;
  // Detect crossing integer boundary (each integer = 1 lap)
  if (raw >= racer.lapsDone + 1) {
    racer.lapsDone++;
    if (racer.isPlayer && racer.lapsDone < TOTAL_LAPS) {
      flashLapMessage(`Lap ${racer.lapsDone + 1} / ${TOTAL_LAPS}!`);
    }
    if (racer.lapsDone >= TOTAL_LAPS && !racer.finished) {
      racer.finished    = true;
      placesFinished   += 1;
      racer.finishPlace = placesFinished;
      if (racer.isPlayer) endRace();
    }
  }
}

function flashLapMessage(text) {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = `
    position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    font-size:3rem;font-weight:900;color:#ffdd57;
    text-shadow:0 0 30px rgba(255,220,80,0.9);
    pointer-events:none;z-index:20;animation:countPulse 1.2s ease-out forwards;
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

/* ============================================================
   HUD updates
   ============================================================ */
function updateHUD(frameCount) {
  const player = racers[0];

  // Sorted positions (by laps + progress)
  const sorted = [...racers].sort((a, b) =>
    (b.lapsDone + (b.progress % 1)) - (a.lapsDone + (a.progress % 1))
  );
  const pos = sorted.findIndex(r => r.isPlayer) + 1;

  document.getElementById('hud-position').textContent = ORDINALS[pos - 1] || pos + 'th';
  document.getElementById('hud-lap').textContent =
    `Lap ${Math.min(player.lapsDone + 1, TOTAL_LAPS)} / ${TOTAL_LAPS}`;

  const kmh = Math.round(player.speed / MAX_SPEED * 220);
  document.getElementById('hud-speed').textContent = `${kmh} km/h`;
  document.getElementById('hud-speedbar').style.width =
    `${(player.speed / MAX_SPEED) * 100}%`;

  // Side leaderboard
  const nameHtml = sorted.map((r, i) =>
    `<div style="color:${r.isPlayer ? '#ffdd57' : '#e2d9ff'};font-weight:${r.isPlayer ? '700' : '400'}">
       ${i + 1}. ${r.name}
     </div>`
  ).join('');
  document.getElementById('hud-names').innerHTML = nameHtml;
}

/* ============================================================
   Camera
   ============================================================ */
const camOffset  = new THREE.Vector3();
const camLookAt  = new THREE.Vector3();
const smoothCamPos = new THREE.Vector3();
const smoothCamLook = new THREE.Vector3();

function updateCamera() {
  const player  = racers[0];
  const t       = player.progress % 1;
  const tangent = trackCurve.getTangent(t);

  // Camera position: behind and slightly above the player car
  camOffset.copy(player.mesh.position)
    .addScaledVector(tangent, -8)
    .add(new THREE.Vector3(0, 3.5, 0));

  // Look at: a bit ahead of the player
  camLookAt.copy(player.mesh.position)
    .addScaledVector(tangent, 5);

  // Smooth follow
  smoothCamPos.lerp(camOffset,  0.1);
  smoothCamLook.lerp(camLookAt, 0.12);

  camera.position.copy(smoothCamPos);
  camera.lookAt(smoothCamLook);
}

/* ============================================================
   Race lifecycle
   ============================================================ */
function startCountdown() {
  gameState = 'countdown';
  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('countdown-screen').classList.remove('hidden');

  const countEl = document.getElementById('countdown-text');
  let count     = 3;

  function tick() {
    if (count > 0) {
      countEl.textContent = count;
      // Re-trigger animation
      countEl.style.animation = 'none';
      void countEl.offsetWidth;
      countEl.style.animation = 'countPulse 0.9s ease-out';
      count--;
      setTimeout(tick, 900);
    } else {
      countEl.textContent = 'GO! 🏁';
      countEl.style.animation = 'none';
      void countEl.offsetWidth;
      countEl.style.animation = 'countPulse 0.6s ease-out';
      setTimeout(() => {
        document.getElementById('countdown-screen').classList.add('hidden');
        document.getElementById('hud').classList.remove('hidden');
        gameState = 'racing';
      }, 700);
    }
  }
  tick();
}

function endRace() {
  gameState = 'finished';

  // Give AI a moment to finish if they're close
  setTimeout(() => {
    const sorted = [...racers].sort((a, b) =>
      (b.lapsDone + (b.progress % 1)) - (a.lapsDone + (a.progress % 1))
    );

    const playerPlace = sorted.findIndex(r => r.isPlayer) + 1;
    const emojis      = ['🥇', '🥈', '🥉', '🏅'];

    document.getElementById('finish-emoji').textContent =
      playerPlace === 1 ? '🎉🏆🎉' : playerPlace === 2 ? '🥈✨' : '🏅';
    document.getElementById('finish-title').textContent =
      playerPlace === 1 ? 'You Won! Amazing!' : `You finished ${ORDINALS[playerPlace - 1]}!`;

    const resultsHtml = sorted.map((r, i) =>
      `<div class="result-row">
         <span class="result-pos">${emojis[i] || i + 1}</span>
         <span class="result-name" style="color:${r.isPlayer ? '#ffdd57' : '#e2d9ff'}">${r.name}</span>
       </div>`
    ).join('');
    document.getElementById('finish-results').innerHTML = resultsHtml;

    document.getElementById('hud').classList.add('hidden');
    document.getElementById('finish-screen').classList.remove('hidden');
  }, 1200);
}

function resetRace() {
  placesFinished = 0;
  racers.forEach((r, i) => {
    r.progress    = i * 0.015;
    r.laneOffset  = 0;
    r.speed       = 0;
    r.lapsDone    = 0;
    r.finished    = false;
    r.finishPlace = 0;
  });
  smoothCamPos.set(0, 0, 0);
  smoothCamLook.set(0, 0, 0);

  document.getElementById('finish-screen').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  gameState = 'racing';
}

/* ============================================================
   Animation loop
   ============================================================ */
let frameCount = 0;

function animate() {
  animId = requestAnimationFrame(animate);
  frameCount++;

  if (gameState === 'racing') {
    racers.forEach(racer => {
      if (racer.finished) return;

      if (racer.isPlayer) updatePlayerInput(racer);
      else                updateAI(racer, frameCount);

      racer.progress += racer.speed;
      checkLap(racer);
      positionRacer(racer);
    });

    updateCamera();
    updateHUD(frameCount);
  }

  renderer.render(scene, camera);
}

/* ============================================================
   UI event listeners
   ============================================================ */
document.getElementById('startBtn').addEventListener('click', () => {
  startCountdown();
  // Warm up camera position at start
  const player  = racers[0];
  smoothCamPos.copy(player.mesh.position).add(new THREE.Vector3(0, 5, -10));
  smoothCamLook.copy(player.mesh.position);
});

document.getElementById('restartBtn').addEventListener('click', resetRace);

/* ============================================================
   Initialize & run
   ============================================================ */
function init() {
  setupLights();
  buildTrack();
  initRacers();

  // Place racers at start positions
  racers.forEach(positionRacer);

  // Start camera roughly behind player
  const player = racers[0];
  smoothCamPos.copy(player.mesh.position).add(new THREE.Vector3(0, 5, -12));
  smoothCamLook.copy(player.mesh.position);
  camera.position.copy(smoothCamPos);
  camera.lookAt(smoothCamLook);

  animate();
}

init();
