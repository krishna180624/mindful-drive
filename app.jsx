import { useState, useEffect, useRef, useCallback, useReducer } from "react";
import * as THREE from "three";
import * as Tone from "tone";

// ═══════════════════════════════════════════════════════
// CONSTANTS & CONFIG
// ═══════════════════════════════════════════════════════
const CFG = {
  ROAD_SEGMENTS: 80,
  ROAD_WIDTH: 12,
  ROAD_LENGTH: 800,
  TREE_COUNT: 60,
  CLOUD_COUNT: 18,
  RAIN_COUNT: 900,
  MAX_SPEED: 80,
  RACE_SPEED: 200,
  ACCEL: 0.9,
  DECEL: 1.4,
  BRAKE_DECEL: 3.5,
  CAM_HEIGHT: 3.2,
  CAM_BACK: 10,
  COLORS: {
    SKY_TOP:    0x1a2535,
    SKY_MID:    0x2c3e55,
    SKY_BOTTOM: 0x4a6080,
    FOG:        0x3d5570,
    ROAD:       0x1e1e24,
    ROAD_EDGE:  0xe8d84a,
    LANE:       0xe8e0c8,
    GRASS:      0x2d4a29,
    TREE_DARK:  0x1e3318,
    TREE_MID:   0x2a4422,
  }
};

// ═══════════════════════════════════════════════════════
// STATE REDUCER
// ═══════════════════════════════════════════════════════
const initialState = {
  speed: 0,
  going: false,
  racing: false,
  braking: false,
  started: false,
  muted: false,
};

function reducer(state, action) {
  switch (action.type) {
    case "SET_GOING":   return { ...state, going: action.v, racing: false, braking: false };
    case "SET_RACING":  return { ...state, racing: action.v, going: false, braking: false };
    case "SET_BRAKING": return { ...state, braking: action.v, going: false, racing: false };
    case "SET_SPEED":   return { ...state, speed: action.v };
    case "START":       return { ...state, started: true };
    case "TOGGLE_MUTE": return { ...state, muted: !state.muted };
    default: return state;
  }
}

// ═══════════════════════════════════════════════════════
// THREE.JS SCENE
// ═══════════════════════════════════════════════════════
class DriveScene {
  constructor(canvas, w, h) {
    this.w = w; this.h = h;
    this.time = 0;
    this.speed = 0;
    this.clouds = [];
    this.trees = [];
    this.laneMarks = [];
    this.rainPositions = null;
    this.rainVelocities = null;
    this._init(canvas);
  }

  _init(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.w, this.h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(CFG.COLORS.FOG, 80, 320);
    this.scene.background = new THREE.Color(CFG.COLORS.SKY_TOP);

    this.camera = new THREE.PerspectiveCamera(62, this.w / this.h, 0.1, 500);
    this.camera.position.set(0, CFG.CAM_HEIGHT, CFG.CAM_BACK);
    this.camera.lookAt(0, 1.5, -80);

    this._buildSky();
    this._buildRoad();
    this._buildGrass();
    this._buildTrees();
    this._buildClouds();
    this._buildRain();
    this._buildCar();
    this._buildLights();
    this._buildLaneMarks();
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(400, 32, 16);
    const colors = [];
    const posArr = geo.attributes.position.array;
    for (let i = 0; i < posArr.length; i += 3) {
      const y = posArr[i + 1];
      const t = Math.max(0, Math.min(1, (y + 400) / 800));
      const top    = new THREE.Color(CFG.COLORS.SKY_TOP);
      const mid    = new THREE.Color(CFG.COLORS.SKY_MID);
      const bottom = new THREE.Color(CFG.COLORS.SKY_BOTTOM);
      const c = t > 0.5
        ? top.clone().lerp(mid, (1 - t) * 2)
        : mid.clone().lerp(bottom, (0.5 - t) * 2);
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
    this.scene.add(new THREE.Mesh(geo, mat));

    const glowGeo = new THREE.PlaneGeometry(600, 60);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x4a7a9b, transparent: true, opacity: 0.18,
      depthWrite: false, side: THREE.DoubleSide
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.set(0, -2, -200);
    glow.rotation.x = -0.15;
    this.scene.add(glow);
  }

  _buildRoad() {
    const group = new THREE.Group();

    const roadGeo = new THREE.PlaneGeometry(CFG.ROAD_WIDTH, CFG.ROAD_LENGTH, 1, CFG.ROAD_SEGMENTS);
    const roadMat = new THREE.MeshLambertMaterial({ color: CFG.COLORS.ROAD });
    this.road = new THREE.Mesh(roadGeo, roadMat);
    this.road.rotation.x = -Math.PI / 2;
    this.road.position.set(0, 0, -CFG.ROAD_LENGTH / 2 + 20);
    this.road.receiveShadow = true;
    group.add(this.road);

    const surfGeo = new THREE.PlaneGeometry(CFG.ROAD_WIDTH - 0.4, CFG.ROAD_LENGTH, 2, 120);
    const posArr = surfGeo.attributes.position.array;
    for (let i = 0; i < posArr.length; i += 3) {
      posArr[i + 2] += (Math.random() - 0.5) * 0.012;
    }
    surfGeo.computeVertexNormals();
    const surfMat = new THREE.MeshLambertMaterial({ color: 0x252530, transparent: true, opacity: 0.6 });
    const surf = new THREE.Mesh(surfGeo, surfMat);
    surf.rotation.x = -Math.PI / 2;
    surf.position.set(0, 0.005, -CFG.ROAD_LENGTH / 2 + 20);
    group.add(surf);

    [-1, 1].forEach(side => {
      const edgeGeo = new THREE.PlaneGeometry(0.18, CFG.ROAD_LENGTH);
      const edgeMat = new THREE.MeshBasicMaterial({ color: CFG.COLORS.ROAD_EDGE, transparent: true, opacity: 0.85 });
      const edge = new THREE.Mesh(edgeGeo, edgeMat);
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(side * (CFG.ROAD_WIDTH / 2 - 0.1), 0.01, -CFG.ROAD_LENGTH / 2 + 20);
      group.add(edge);
    });

    this.scene.add(group);
  }

  _buildGrass() {
    [-1, 1].forEach(side => {
      const geo = new THREE.PlaneGeometry(200, CFG.ROAD_LENGTH);
      const mat = new THREE.MeshLambertMaterial({ color: CFG.COLORS.GRASS });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(side * (CFG.ROAD_WIDTH / 2 + 100), -0.02, -CFG.ROAD_LENGTH / 2 + 20);
      this.scene.add(mesh);
    });
  }

  _buildLaneMarks() {
    this.laneMarkGroup = new THREE.Group();
    const markCount = 28;
    const spacing   = 14;
    for (let i = 0; i < markCount; i++) {
      const geo = new THREE.PlaneGeometry(0.25, 4.5);
      const mat = new THREE.MeshBasicMaterial({ color: CFG.COLORS.LANE, transparent: true, opacity: 0.82 });
      const m   = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, 0.012, -i * spacing);
      this.laneMarkGroup.add(m);
      this.laneMarks.push(m);
    }
    this.scene.add(this.laneMarkGroup);
    this.laneOffset = 0;
  }

  _buildTrees() {
    this.treeGroup = new THREE.Group();
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3d2b1f });

    const makeTree = (x, z, scale) => {
      const g = new THREE.Group();
      const tGeo = new THREE.CylinderGeometry(0.12 * scale, 0.2 * scale, 1.8 * scale, 6);
      const trunk = new THREE.Mesh(tGeo, trunkMat);
      trunk.position.y = 0.9 * scale;
      trunk.castShadow = true;
      g.add(trunk);

      const fc = [CFG.COLORS.TREE_DARK, CFG.COLORS.TREE_MID, 0x234020][Math.floor(Math.random() * 3)];
      const fMat = new THREE.MeshLambertMaterial({ color: fc });
      const type = Math.floor(Math.random() * 3);

      if (type === 0) {
        [0, 1, 2].forEach(layer => {
          const cGeo = new THREE.ConeGeometry((2.2 - layer * 0.5) * scale, (3 - layer * 0.5) * scale, 7);
          const cone = new THREE.Mesh(cGeo, fMat);
          cone.position.y = (1.8 + layer * 1.6) * scale;
          cone.castShadow = true;
          g.add(cone);
        });
      } else if (type === 1) {
        const sGeo = new THREE.SphereGeometry(1.8 * scale, 8, 6);
        const sphere = new THREE.Mesh(sGeo, fMat);
        sphere.position.y = 3.8 * scale;
        sphere.castShadow = true;
        g.add(sphere);
        const s2 = new THREE.Mesh(
          new THREE.SphereGeometry(1.2 * scale, 7, 5),
          new THREE.MeshLambertMaterial({ color: 0x1e3a1a })
        );
        s2.position.set(0.8 * scale, 4.5 * scale, 0.3 * scale);
        g.add(s2);
      } else {
        const cGeo = new THREE.ConeGeometry(1.2 * scale, 7 * scale, 6);
        const cone = new THREE.Mesh(cGeo, fMat);
        cone.position.y = 5 * scale;
        cone.castShadow = true;
        g.add(cone);
      }

      g.position.set(x, 0, z);
      return g;
    };

    for (let i = 0; i < CFG.TREE_COUNT; i++) {
      const z     = -i * (CFG.ROAD_LENGTH / CFG.TREE_COUNT) + 15;
      const side  = i % 2 === 0 ? 1 : -1;
      const xOff  = CFG.ROAD_WIDTH / 2 + 2 + Math.random() * 6;
      const scale = 0.7 + Math.random() * 0.8;
      this.treeGroup.add(makeTree(side * xOff, z, scale));
      if (Math.random() > 0.4) {
        this.treeGroup.add(makeTree(side * (xOff + 3 + Math.random() * 5), z + Math.random() * 8 - 4, 0.5 + Math.random() * 0.6));
      }
    }
    this.scene.add(this.treeGroup);
  }

  _buildClouds() {
    const cloudGroup = new THREE.Group();
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0x8aa4b8, transparent: true, opacity: 0.62, depthWrite: false });
    const darkMat  = new THREE.MeshLambertMaterial({ color: 0x5a7088, transparent: true, opacity: 0.45, depthWrite: false });

    for (let i = 0; i < CFG.CLOUD_COUNT; i++) {
      const g   = new THREE.Group();
      const mat = i % 3 === 0 ? darkMat : cloudMat;
      const blobCount = 3 + Math.floor(Math.random() * 4);
      for (let b = 0; b < blobCount; b++) {
        const rx = 8 + Math.random() * 16;
        const ry = 4 + Math.random() * 7;
        const rz = 6 + Math.random() * 10;
        const geo = new THREE.SphereGeometry(1, 8, 6);
        geo.scale(rx, ry, rz);
        const blob = new THREE.Mesh(geo, mat.clone());
        blob.position.set((Math.random() - 0.5) * rx * 1.5, (Math.random() - 0.5) * ry * 0.6, (Math.random() - 0.5) * rz * 0.5);
        g.add(blob);
      }
      g.position.set((Math.random() - 0.5) * 300, 35 + Math.random() * 55, -40 - Math.random() * 280);
      g.userData.driftSpeed  = 0.03 + Math.random() * 0.05;
      cloudGroup.add(g);
      this.clouds.push(g);
    }
    this.scene.add(cloudGroup);
  }

  _buildRain() {
    const positions  = new Float32Array(CFG.RAIN_COUNT * 3);
    const velocities = new Float32Array(CFG.RAIN_COUNT);
    for (let i = 0; i < CFG.RAIN_COUNT; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 120;
      positions[i * 3 + 1] = Math.random() * 80;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 120 - 40;
      velocities[i]        = 0.4 + Math.random() * 0.6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.rainPositions  = positions;
    this.rainVelocities = velocities;
    const mat = new THREE.PointsMaterial({ color: 0x88b4cc, size: 0.08, transparent: true, opacity: 0.45, sizeAttenuation: true, depthWrite: false });
    this.rain = new THREE.Points(geo, mat);
    this.scene.add(this.rain);
  }

  _buildCar() {
    const carGroup = new THREE.Group();
    const bodyMat  = new THREE.MeshLambertMaterial({ color: 0x2a3d6b });
    const roofMat  = new THREE.MeshLambertMaterial({ color: 0x1f3058 });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x7fb8d8, transparent: true, opacity: 0.7 });
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x151515 });
    const rimMat   = new THREE.MeshLambertMaterial({ color: 0x888888 });
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xfffde0 });
    const tailMat  = new THREE.MeshBasicMaterial({ color: 0xff2020 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.55, 4.2), bodyMat);
    body.position.y = 0.65; body.castShadow = true;
    carGroup.add(body);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 2.2), roofMat);
    cabin.position.set(0, 1.12, -0.15); cabin.castShadow = true;
    carGroup.add(cabin);

    const wind = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 0.48), glassMat);
    wind.position.set(0, 1.08, 0.96); wind.rotation.x = 0.28;
    carGroup.add(wind);

    const rear = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.42), glassMat);
    rear.position.set(0, 1.05, -1.27); rear.rotation.x = -0.28;
    carGroup.add(rear);

    const hood = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 1.1), bodyMat);
    hood.position.set(0, 0.96, 1.55); hood.rotation.x = -0.12;
    carGroup.add(hood);

    const bGeo = new THREE.BoxGeometry(2.1, 0.22, 0.18);
    const bumpMat = new THREE.MeshLambertMaterial({ color: 0x1a2a50 });
    const frontBump = new THREE.Mesh(bGeo, bumpMat);
    frontBump.position.set(0, 0.52, 2.18);
    carGroup.add(frontBump);
    const rearBump = frontBump.clone();
    rearBump.position.set(0, 0.52, -2.18);
    carGroup.add(rearBump);

    this.wheels = [];
    [[-1.1,0.3,1.3],[1.1,0.3,1.3],[-1.1,0.3,-1.3],[1.1,0.3,-1.3]].forEach(([x,y,z]) => {
      const wg   = new THREE.Group();
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 18), wheelMat);
      tire.rotation.z = Math.PI / 2;
      wg.add(tire);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.24, 8), rimMat);
      rim.rotation.z = Math.PI / 2;
      wg.add(rim);
      wg.position.set(x, y, z);
      wg.castShadow = true;
      carGroup.add(wg);
      this.wheels.push(wg);
    });

    const hlGeo = new THREE.SphereGeometry(0.14, 8, 6);
    [-0.65, 0.65].forEach(x => {
      carGroup.add(Object.assign(new THREE.Mesh(hlGeo, lightMat), { position: new THREE.Vector3(x, 0.68, 2.18) }));
      const pl = new THREE.PointLight(0xfffde0, 1.2, 18);
      pl.position.set(x, 0.68, 2.5);
      carGroup.add(pl);
    });

    const tlGeo = new THREE.BoxGeometry(0.28, 0.14, 0.06);
    [-0.8, 0.8].forEach(x => {
      const tl = new THREE.Mesh(tlGeo, tailMat);
      tl.position.set(x, 0.72, -2.12);
      carGroup.add(tl);
    });

    this.brakeLights = [];
    [-0.8, 0.8].forEach(x => {
      const bl = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.12, 0.05),
        new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0 })
      );
      bl.position.set(x, 0.72, -2.13);
      carGroup.add(bl);
      this.brakeLights.push(bl);
    });

    this.scene.add(carGroup);
    this.car = carGroup;
    this.carBounceT = 0;
  }

  _buildLights() {
    this.scene.add(new THREE.AmbientLight(0x4a6070, 1.2));
    const dir = new THREE.DirectionalLight(0x7090a0, 0.8);
    dir.position.set(-30, 60, 30);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far  = 200;
    dir.shadow.camera.left = dir.shadow.camera.bottom = -40;
    dir.shadow.camera.right = dir.shadow.camera.top   =  40;
    dir.shadow.bias = -0.001;
    this.scene.add(dir);
    this.scene.add(new THREE.HemisphereLight(0x6080a0, 0x2d4a25, 0.6));
  }

  update(dt, speed, braking) {
    this.time  += dt;
    this.speed  = speed;
    const ratio = speed / CFG.RACE_SPEED;

    // Lane marks scroll
    const laneSpeed = speed * 0.05;
    this.laneOffset = (this.laneOffset + laneSpeed * dt) % 14;
    this.laneMarks.forEach((m, i) => {
      let z = -i * 14 + this.laneOffset;
      while (z > 8)  z -= 14 * this.laneMarks.length;
      while (z < -14 * this.laneMarks.length) z += 14 * this.laneMarks.length;
      m.position.z = z;
    });

    // Trees scroll
    this.treeGroup.children.forEach(t => {
      t.position.z += speed * 0.04 * dt;
      if (t.position.z > 16) t.position.z -= CFG.ROAD_LENGTH;
    });

    // Clouds drift
    this.clouds.forEach(c => {
      c.position.x += c.userData.driftSpeed * dt * 3;
      if (c.position.x > 180) c.position.x = -180;
      c.position.z += speed * 0.008 * dt;
      if (c.position.z > 20) c.position.z -= 300;
    });

    // Rain physics
    const rp = this.rainPositions;
    for (let i = 0; i < CFG.RAIN_COUNT; i++) {
      rp[i*3+1] -= (this.rainVelocities[i] * 28 + speed * 0.1) * dt;
      rp[i*3+2] -= speed * 0.02 * dt;
      if (rp[i*3+1] < -4) {
        rp[i*3+1] = 75 + Math.random() * 10;
        rp[i*3]   = (Math.random() - 0.5) * 120;
        rp[i*3+2] = (Math.random() - 0.5) * 120 - 40;
      }
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    this.rain.material.opacity = 0.25 + Math.min(ratio * 0.35, 0.35);

    // Car bounce
    this.carBounceT += dt * (speed > 0 ? 8 + ratio * 14 : 0);
    this.car.position.y = speed > 0 ? Math.sin(this.carBounceT) * 0.03 * (0.3 + ratio) : 0;
    this.car.rotation.z = speed > 0 ? Math.sin(this.carBounceT * 1.3) * 0.008 * ratio : 0;

    // Wheel spin
    this.wheels.forEach(w => { w.rotation.y += speed * 0.02 * dt; });

    // Brake lights
    const bOpacity = braking ? 0.95 : (speed > 0 ? 0.2 : 0);
    this.brakeLights.forEach(b => { b.material.opacity = bOpacity; });

    // Camera shake at high speed
    const camShake = ratio > 0.6 ? Math.sin(this.time * 22) * 0.012 * ratio : 0;
    this.camera.position.y = CFG.CAM_HEIGHT + camShake;

    // FOV stretch
    const camFOV = 62 + ratio * 18;
    if (Math.abs(this.camera.fov - camFOV) > 0.5) {
      this.camera.fov += (camFOV - this.camera.fov) * 0.04;
      this.camera.updateProjectionMatrix();
    }

    // Fog density
    this.scene.fog.near = 80 - ratio * 30;
    this.scene.fog.far  = 320 - ratio * 80;

    this.renderer.toneMappingExposure = 0.9 + ratio * 0.4;
    this.renderer.render(this.scene, this.camera);
  }

  resize(w, h) {
    this.w = w; this.h = h;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() { this.renderer.dispose(); }
}

// ═══════════════════════════════════════════════════════
// AUDIO ENGINE (Tone.js)
// ═══════════════════════════════════════════════════════
class DriveAudio {
  constructor() { this.ready = false; }

  async init() {
    if (this.ready) return;
    await Tone.start();

    this._master = new Tone.Gain(0.55).toDestination();

    // Rain noise
    const rainFilter = new Tone.Filter({ type: "bandpass", frequency: 1800, Q: 0.6 });
    const rainGain   = new Tone.Gain(0.22);
    this._rainNoise  = new Tone.Noise("pink");
    this._rainNoise.chain(rainFilter, rainGain, this._master);
    this._rainNoise.start();

    // Wind noise
    const windFilter = new Tone.Filter({ type: "lowpass", frequency: 250, rolloff: -24 });
    const windLFO    = new Tone.LFO({ frequency: 0.07, min: 180, max: 320 }).start();
    windLFO.connect(windFilter.frequency);
    const windGain   = new Tone.Gain(0.18);
    this._windNoise  = new Tone.Noise("white");
    this._windNoise.chain(windFilter, windGain, this._master);
    this._windNoise.start();

    // Engine oscillator bank
    this._engGain   = new Tone.Gain(0).toDestination();
    const engFilter = new Tone.Filter({ type: "lowpass", frequency: 180, Q: 2.5 });
    const engFilter2= new Tone.Filter({ type: "peaking", frequency: 85, gain: 14, Q: 3 });
    this._engFilter = engFilter;
    this._oscBank   = [];

    [0, 3, -4].forEach((detune, i) => {
      const osc = new Tone.Oscillator({ type: "sawtooth", frequency: 38 + i * 2, detune });
      const g   = new Tone.Gain(0.28);
      osc.chain(engFilter2, engFilter, g, this._engGain);
      osc.start();
      this._oscBank.push({ osc, gain: g });
    });

    this._engLFO = new Tone.LFO({ frequency: 14, min: 0.9, max: 1.1 }).start();
    this._engLFO.connect(this._engGain.gain);

    this.ready = true;
  }

  setSpeed(speed) {
    if (!this.ready) return;
    const ratio = Math.min(speed / CFG.RACE_SPEED, 1);
    this._engGain.gain.rampTo(speed > 0 ? 0.08 + ratio * 0.55 : 0, 0.15);
    const baseFreq = 38 + ratio * 120;
    this._oscBank.forEach(({ osc }, i) => osc.frequency.rampTo(baseFreq + i * 4, 0.12));
    this._engLFO.frequency.rampTo(8 + ratio * 24, 0.2);
    this._engFilter.frequency.rampTo(120 + ratio * 240, 0.2);
  }

  setMuted(muted) {
    if (!this.ready) return;
    this._master.gain.rampTo(muted ? 0 : 0.55, 0.5);
  }

  dispose() {
    this._rainNoise?.stop();
    this._windNoise?.stop();
    this._oscBank?.forEach(({ osc }) => osc.stop());
  }
}

// ═══════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════
function Speedometer({ speed }) {
  const ratio = Math.min(speed / CFG.RACE_SPEED, 1);
  const isRacing = speed > CFG.MAX_SPEED;
  const cx = 52; const cy = 52; const r = 38;
  const arc = 220; const startAngle = -200;
  const angle = startAngle + ratio * arc;
  const toRad = d => d * Math.PI / 180;
  const needleX = cx + r * 0.78 * Math.cos(toRad(angle));
  const needleY = cy + r * 0.78 * Math.sin(toRad(angle));
  const arcPath = (deg1, deg2, outerR) => {
    const s1 = toRad(deg1); const s2 = toRad(deg2);
    const x1 = cx + outerR * Math.cos(s1); const y1 = cy + outerR * Math.sin(s1);
    const x2 = cx + outerR * Math.cos(s2); const y2 = cy + outerR * Math.sin(s2);
    return `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${Math.abs(deg2-deg1)>180?1:0} 1 ${x2} ${y2}`;
  };
  const tickPath = (deg, inner, outer) => {
    const rad = toRad(deg);
    return `M ${cx+inner*Math.cos(rad)} ${cy+inner*Math.sin(rad)} L ${cx+outer*Math.cos(rad)} ${cy+outer*Math.sin(rad)}`;
  };
  const ticks = Array.from({ length: 11 }, (_, i) => startAngle + (i / 10) * arc);
  const color = isRacing ? "#ff8c5a" : "#4caf7a";

  return (
    <div style={{
      background: "rgba(10,18,30,0.75)", backdropFilter: "blur(14px)",
      WebkitBackdropFilter: "blur(14px)",
      border: "1px solid rgba(255,255,255,0.12)", borderRadius: "50%",
      padding: "6px",
      boxShadow: "0 4px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)",
    }}>
      <svg width="104" height="104" viewBox="0 0 104 104">
        <circle cx={cx} cy={cy} r="50" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1.5"/>
        <path d={arcPath(startAngle, startAngle + arc, r+6)} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" strokeLinecap="round"/>
        {ratio > 0 && <path d={arcPath(startAngle, angle, r+6)} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 4px ${color}88)` }}/>}
        {ticks.map((deg, i) => (
          <path key={i} d={tickPath(deg, r-7, r-(i%5===0?2:4))}
            stroke={i/10 < ratio ? color : "rgba(255,255,255,0.25)"}
            strokeWidth={i%5===0?1.5:0.8} strokeLinecap="round"/>
        ))}
        <line x1={cx} y1={cy} x2={needleX} y2={needleY}
          stroke={isRacing ? "#ff8c5a" : "#fff"} strokeWidth="1.8" strokeLinecap="round"
          style={{ filter: "drop-shadow(0 0 3px rgba(255,255,255,0.6))", transition: "all 0.08s" }}/>
        <circle cx={cx} cy={cy} r="4" fill={color} style={{ filter: `drop-shadow(0 0 5px ${color})` }}/>
        <text x={cx} y={cy+17} textAnchor="middle" fill={isRacing?"#ff8c5a":"#fff"}
          fontSize="13" fontWeight="bold" fontFamily="monospace"
          style={{ transition: "fill 0.3s" }}>
          {Math.round(speed)}
        </text>
        <text x={cx} y={cy+26} textAnchor="middle"
          fill="rgba(255,255,255,0.38)" fontSize="6" letterSpacing="1.5" fontFamily="serif">
          KM/H
        </text>
      </svg>
    </div>
  );
}

function CtrlBtn({ icon, label, color, onStart, onEnd, active }) {
  const styles = {
    go:    { bg: "linear-gradient(145deg,#3d9b65,#265e3e)", active: "linear-gradient(145deg,#4caf75,#2d7048)", shadow: "rgba(76,175,117,0.55)" },
    race:  { bg: "linear-gradient(145deg,#d4703f,#8f3a18)", active: "linear-gradient(145deg,#ff8c5a,#c45a2a)", shadow: "rgba(255,140,90,0.6)" },
    brake: { bg: "linear-gradient(145deg,#3a5270,#20364e)", active: "linear-gradient(145deg,#4a6882,#2c4a62)", shadow: "rgba(74,104,130,0.45)" },
  };
  const c = styles[color];
  return (
    <button
      onTouchStart={e=>{e.preventDefault();onStart();}}
      onTouchEnd={e=>{e.preventDefault();onEnd();}}
      onMouseDown={onStart} onMouseUp={onEnd} onMouseLeave={onEnd}
      style={{
        flex: 1, maxWidth: color==="brake"?"280px":"150px",
        height: color==="brake"?"58px":"68px",
        background: active ? c.active : c.bg, border: "none", borderRadius: "20px",
        cursor: "pointer", outline: "none",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "2px",
        boxShadow: active
          ? `0 2px 12px ${c.shadow},0 0 0 1px rgba(255,255,255,0.14),inset 0 1px 0 rgba(255,255,255,0.18)`
          : `0 6px 22px ${c.shadow}88,0 0 0 1px rgba(255,255,255,0.08),inset 0 1px 0 rgba(255,255,255,0.1)`,
        transform: active ? "scale(0.96) translateY(2px)" : "scale(1)",
        transition: "transform 0.1s,box-shadow 0.15s,background 0.15s",
        WebkitTapHighlightColor: "transparent",
        userSelect: "none", WebkitUserSelect: "none", touchAction: "manipulation",
      }}
    >
      <span style={{ fontSize: color==="brake"?"1.3rem":"1.5rem", lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: "0.62rem", letterSpacing: "2px", color: "rgba(255,255,255,0.75)", fontFamily: "Georgia,serif", textTransform: "uppercase" }}>{label}</span>
    </button>
  );
}

function StatusChip({ speed, braking, racing }) {
  let text = "parked", color = "rgba(255,255,255,0.35)", glow = "none";
  if (braking && speed > 0) { text = "braking"; color = "#7aaccc"; }
  else if (racing && speed > CFG.MAX_SPEED) { text = "racing 🔥"; color = "#ff8c5a"; glow = "0 0 12px #ff8c5a55"; }
  else if (speed > 0) { text = "cruising ···"; color = "#7abe9a"; glow = "0 0 10px #7abe9a44"; }
  return (
    <div style={{
      background: "rgba(10,18,30,0.7)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
      border: "1px solid rgba(255,255,255,0.1)", borderRadius: "20px", padding: "6px 14px",
      color, fontSize: "0.68rem", letterSpacing: "2px", fontFamily: "Georgia,serif",
      textTransform: "lowercase", boxShadow: glow, transition: "color 0.4s,box-shadow 0.4s",
    }}>
      {text}
    </div>
  );
}

function WelcomeScreen({ onStart }) {
  const [pressed, setPressed] = useState(false);
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 50,
      background: "linear-gradient(180deg,#0d1520f2 0%,#1a2535f5 60%,#0d1520f0 100%)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "24px", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
    }}>
      <div style={{ fontSize: "3.2rem", marginBottom: "12px", filter: "drop-shadow(0 0 20px rgba(126,181,200,0.4))" }}>🚗</div>
      <h1 style={{ fontFamily: "Georgia,serif", fontSize: "2rem", fontWeight: "normal", color: "#fff", textAlign: "center", letterSpacing: "3px", marginBottom: "6px", textShadow: "0 2px 24px rgba(126,181,200,0.5)" }}>
        Mindful Drive
      </h1>
      <p style={{ fontFamily: "Georgia,serif", fontStyle: "italic", color: "rgba(255,255,255,0.4)", fontSize: "0.8rem", letterSpacing: "3px", textTransform: "uppercase", marginBottom: "28px" }}>
        let it all go
      </p>
      <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "16px", padding: "16px 20px", marginBottom: "32px", maxWidth: "280px", textAlign: "center" }}>
        {[["▶  GO","cruise the open road"],["⚡  RACE","feel the speed surge"],["■  BRAKE","slow down, breathe"]].map(([btn,desc]) => (
          <div key={btn} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <span style={{ color: "rgba(255,255,255,0.65)", fontSize: "0.72rem", fontFamily: "monospace", letterSpacing: "1px", minWidth: "72px" }}>{btn}</span>
            <span style={{ color: "rgba(255,255,255,0.28)", fontSize: "0.68rem", fontFamily: "Georgia,serif", fontStyle: "italic" }}>{desc}</span>
          </div>
        ))}
      </div>
      <button
        onTouchStart={e=>{e.preventDefault();setPressed(true);}}
        onTouchEnd={e=>{e.preventDefault();setPressed(false);onStart();}}
        onMouseDown={()=>setPressed(true)}
        onMouseUp={()=>{setPressed(false);onStart();}}
        style={{
          background: pressed ? "linear-gradient(145deg,#5dc98a,#38a366)" : "linear-gradient(145deg,#4caf7a,#2d8b55)",
          border: "none", borderRadius: "50px", padding: "16px 52px",
          color: "#fff", fontSize: "0.9rem", fontFamily: "Georgia,serif", fontWeight: "bold",
          letterSpacing: "3px", textTransform: "uppercase", cursor: "pointer",
          boxShadow: "0 6px 30px rgba(76,175,122,0.55)",
          transform: pressed ? "scale(0.96)" : "scale(1)",
          transition: "transform 0.1s", WebkitTapHighlightColor: "transparent", touchAction: "manipulation",
        }}
      >
        Begin Journey
      </button>
      <p style={{ marginTop: "20px", color: "rgba(255,255,255,0.2)", fontSize: "0.65rem", letterSpacing: "1.5px", fontFamily: "Georgia,serif" }}>
        cloud road · endless · peaceful
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════
export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const canvasRef  = useRef(null);
  const sceneRef   = useRef(null);
  const audioRef   = useRef(null);
  const rafRef     = useRef(null);
  const lastTRef   = useRef(null);
  const speedRef   = useRef(0);
  const stateRef   = useRef(state);
  const breatheRef = useRef(null);
  const [showBreathe, setShowBreathe] = useState(false);

  stateRef.current = state;

  useEffect(() => {
    if (!state.started || !canvasRef.current) return;
    const w = window.innerWidth; const h = window.innerHeight;
    sceneRef.current = new DriveScene(canvasRef.current, w, h);
    const onResize = () => sceneRef.current?.resize(window.innerWidth, window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); sceneRef.current?.dispose(); };
  }, [state.started]);

  useEffect(() => {
    if (!state.started) return;
    audioRef.current = new DriveAudio();
    audioRef.current.init().catch(console.warn);
    return () => audioRef.current?.dispose();
  }, [state.started]);

  useEffect(() => {
    if (!state.started) return;
    lastTRef.current = performance.now();
    const loop = (now) => {
      const dt = Math.min((now - lastTRef.current) / 1000, 0.05);
      lastTRef.current = now;
      const s = stateRef.current;
      let sp = speedRef.current;

      if (s.braking)      sp = Math.max(0, sp - CFG.BRAKE_DECEL * 60 * dt);
      else if (s.racing)  sp = Math.min(CFG.RACE_SPEED, sp + CFG.ACCEL * 1.8 * 60 * dt);
      else if (s.going)   sp = Math.min(CFG.MAX_SPEED, sp + CFG.ACCEL * 60 * dt);
      else                sp = Math.max(0, sp - CFG.DECEL * 60 * dt);

      speedRef.current = sp;
      dispatch({ type: "SET_SPEED", v: sp });
      audioRef.current?.setSpeed(sp);
      sceneRef.current?.update(dt, sp, s.braking);

      if (sp < 0.5) {
        if (!breatheRef.current) breatheRef.current = setTimeout(() => setShowBreathe(true), 3200);
      } else {
        clearTimeout(breatheRef.current); breatheRef.current = null;
        setShowBreathe(false);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(rafRef.current); clearTimeout(breatheRef.current); };
  }, [state.started]);

  useEffect(() => { audioRef.current?.setMuted(state.muted); }, [state.muted]);

  const isRacing = state.speed > CFG.MAX_SPEED;

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", justifyContent: "center", background: "#0d1520", overflow: "hidden" }}>
      <div style={{ position: "relative", width: "min(430px, 100vw)", height: "100svh", overflow: "hidden" }}>

        <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: state.started ? "block" : "none" }}/>

        {isRacing && (
          <div style={{ position:"absolute",inset:0,zIndex:8,pointerEvents:"none",
            background:"radial-gradient(ellipse 70% 60% at 50% 50%,transparent 30%,rgba(0,0,0,0.35) 100%)"}}/>
        )}

        <div style={{
          position:"absolute",top:"46%",left:"50%",transform:"translate(-50%,-50%)",
          zIndex:20,pointerEvents:"none",textAlign:"center",
          opacity:showBreathe?1:0,transition:"opacity 2s ease",
        }}>
          <p style={{ fontFamily:"Georgia,serif",fontStyle:"italic",color:"rgba(255,255,255,0.42)",fontSize:"1rem",letterSpacing:"4px",textShadow:"0 2px 12px rgba(0,0,0,0.5)" }}>
            breathe &nbsp;·&nbsp; just drive
          </p>
        </div>

        {state.started && (
          <>
            <div style={{ position:"absolute",top:"14px",right:"14px",zIndex:20 }}>
              <Speedometer speed={state.speed}/>
            </div>
            <div style={{ position:"absolute",top:"18px",left:"14px",zIndex:20 }}>
              <StatusChip speed={state.speed} braking={state.braking} racing={state.racing}/>
            </div>
            <button
              onClick={() => dispatch({ type:"TOGGLE_MUTE" })}
              style={{
                position:"absolute",bottom:"175px",right:"14px",zIndex:30,
                width:"44px",height:"44px",borderRadius:"50%",
                background:"rgba(10,18,30,0.7)",border:"1px solid rgba(255,255,255,0.12)",
                backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",
                color:state.muted?"rgba(255,255,255,0.25)":"rgba(255,255,255,0.75)",
                fontSize:"1.2rem",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
                transition:"all 0.2s",WebkitTapHighlightColor:"transparent",touchAction:"manipulation",
              }}
            >
              {state.muted ? "🔇" : "🎵"}
            </button>
            <div style={{
              position:"absolute",bottom:0,left:0,right:0,zIndex:30,
              padding:"0 18px 22px",display:"flex",flexDirection:"column",alignItems:"center",gap:"12px",
              background:"linear-gradient(transparent,rgba(10,18,30,0.75) 40%)",
            }}>
              <div style={{ display:"flex",gap:"12px",width:"100%",justifyContent:"center" }}>
                <CtrlBtn icon="▶" label="Go" color="go" active={state.going}
                  onStart={()=>dispatch({type:"SET_GOING",v:true})}
                  onEnd={()=>dispatch({type:"SET_GOING",v:false})}/>
                <CtrlBtn icon="⚡" label="Race" color="race" active={state.racing}
                  onStart={()=>dispatch({type:"SET_RACING",v:true})}
                  onEnd={()=>dispatch({type:"SET_RACING",v:false})}/>
              </div>
              <div style={{ display:"flex",justifyContent:"center",width:"100%" }}>
                <CtrlBtn icon="■" label="Brake" color="brake" active={state.braking}
                  onStart={()=>dispatch({type:"SET_BRAKING",v:true})}
                  onEnd={()=>dispatch({type:"SET_BRAKING",v:false})}/>
              </div>
            </div>
          </>
        )}

        {!state.started && <WelcomeScreen onStart={()=>dispatch({type:"START"})}/>}
      </div>
    </div>
  );
}
