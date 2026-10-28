import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';

const COLORS = { rbspa: '#56d8ed', rbspb: '#ffbc6b' };
const NAMES = { rbspa: 'Probe A', rbspb: 'Probe B' };
const IDS = Object.keys(COLORS);
const DEFAULT_GAP_MS = 60001;
const finiteSample = p => p && [p.t, p.x, p.y, p.z].every(Number.isFinite);

function lowerBound(samples, time) {
  let lo = 0, hi = samples.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (samples[mid].t < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function line(points, color, opacity = 1) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
}

function circle(radius, plane = 'xy', height = 0, count = 192) {
  const points = [];
  for (let i = 0; i <= count; i++) {
    const a = i / count * Math.PI * 2;
    const u = radius * Math.cos(a), v = radius * Math.sin(a);
    points.push(plane === 'xy' ? new THREE.Vector3(u, v, height) : new THREE.Vector3(u, height, v));
  }
  return points;
}

/**
 * All world coordinates are the supplied geocentric Cartesian coordinates in R_E.
 * This view performs no coordinate conversion, orbit propagation, or interpolation.
 * windowMs is a half-width: trajectories show [time-windowMs, time+windowMs].
 * Each connected line segment requires adjacent valid samples at native cadence.
 */
export class OrbitScene {
  constructor(container) {
    this.container = container;
    this.frame = 'GSE';
    this.width = 1;
    this.height = 1;
    this.disposed = false;
    this.dirty = true;
    this.cache = {};
    this.labels = [];
    this.visibility = { rbspa: true, rbspb: true };
    this.projected = new THREE.Vector3();
    this.toPoint = new THREE.Vector3();

    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(43, 1, 0.05, 200);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(7, -9, 13);

    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (cause) {
      throw new Error('The 3D view requires WebGL. Enable hardware acceleration or try another modern browser.', { cause });
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x07111e, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;outline:none;touch-action:none;';
    this.renderer.domElement.setAttribute('aria-label', 'Interactive three-dimensional spacecraft positions. Drag to rotate, scroll to zoom, and right-drag to pan.');
    this.renderer.domElement.tabIndex = 0;
    container.append(this.renderer.domElement);
    this.overlay = document.createElement('div');
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;';
    container.append(this.overlay);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.controls.dampingFactor = 0.085;
    this.controls.minDistance = 2.3;
    this.controls.maxDistance = 60;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.rotateSpeed = 0.65;
    this.controls.zoomSpeed = 0.8;
    this.onChange = () => { this.dirty = true; };
    this.controls.addEventListener('change', this.onChange);
    this.scene.add(new THREE.AmbientLight(0xc4e9ff, 0.85));
    const keyLight = new THREE.DirectionalLight(0xd3edff, 2.3);
    keyLight.position.set(-5, -6, 9);
    this.scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x23587d, 0.7);
    fillLight.position.set(6, 3, -2);
    this.scene.add(fillLight);

    this.makeEarth();
    this.makeReferenceGrid();
    this.makeProbes();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.animate = this.animate.bind(this);
    this.animationId = requestAnimationFrame(this.animate);
  }

  makeEarth() {
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 48),
      new THREE.MeshStandardMaterial({ color: 0x173e56, roughness: 0.92, metalness: 0.06 }),
    );
    this.scene.add(sphere);
    // The graticule belongs to the displayed frame. It is not terrestrial geography.
    const grid = new THREE.Group();
    for (const latitude of [-60, -30, 0, 30, 60]) {
      const radians = latitude * Math.PI / 180;
      grid.add(line(circle(Math.cos(radians) * 1.002, 'xy', Math.sin(radians) * 1.002), 0x70a3bb, latitude === 0 ? 0.27 : 0.16));
    }
    for (let longitude = 0; longitude < 180; longitude += 30) {
      const meridian = line(circle(1.003, 'xz'), 0x70a3bb, 0.15);
      meridian.rotation.z = longitude * Math.PI / 180;
      grid.add(meridian);
    }
    this.scene.add(grid);
    // A subtle edge is a display treatment, not a modeled atmospheric boundary.
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.025, 48, 32),
      new THREE.ShaderMaterial({
        uniforms: { glowColor: { value: new THREE.Color(0x56a7ce) } },
        vertexShader: `varying vec3 vNormal; varying vec3 vView;
          void main(){ vec4 p=modelViewMatrix*vec4(position,1.0);
          vNormal=normalize(normalMatrix*normal);vView=normalize(-p.xyz);
          gl_Position=projectionMatrix*p; }`,
        fragmentShader: `uniform vec3 glowColor; varying vec3 vNormal; varying vec3 vView;
          void main(){float rim=pow(1.0-abs(dot(normalize(vNormal),normalize(vView))),3.0);
          gl_FragColor=vec4(glowColor,rim*0.22);}`,
        transparent: true, depthWrite: false, side: THREE.FrontSide,
      }),
    );
    this.scene.add(atmosphere);
  }

  makeReferenceGrid() {
    for (const radius of [2, 4, 6]) {
      this.scene.add(line(circle(radius), 0x516d86, 0.20));
      this.addLabel(`${radius} Rᴇ`, new THREE.Vector3(radius * 0.707, -radius * 0.707, 0), {
        color: '#6f8799', size: 10, offset: [8, 7],
      });
    }
    // Subdued Cartesian reference axes, all expressed in the selected frame.
    for (const [axis, vector] of [
      ['X', new THREE.Vector3(7.0, 0, 0)],
      ['Y', new THREE.Vector3(0, 7.0, 0)],
      ['Z', new THREE.Vector3(0, 0, 4.6)],
    ]) {
      this.scene.add(line([vector.clone().multiplyScalar(-1), vector], 0x7790a9, 0.21));
      this.addLabel(`+${axis}`, vector, { color: '#9bb0c2', size: 11, axis });
    }
  }

  makeProbes() {
    this.probes = {};
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 64;
    const ctx = glowCanvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(0.25, 'rgba(255,255,255,0.22)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    this.glowTexture = new THREE.CanvasTexture(glowCanvas);
    for (const id of IDS) {
      const group = new THREE.Group();
      const point = new THREE.Mesh(
        new THREE.SphereGeometry(0.073, 20, 14),
        new THREE.MeshBasicMaterial({ color: COLORS[id] }),
      );
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTexture, color: COLORS[id], transparent: true,
        opacity: 0.7, depthWrite: false, depthTest: true,
      }));
      glow.scale.setScalar(0.48);
      group.add(point, glow);
      group.visible = false;
      this.scene.add(group);
      const trajectoryGroup = new THREE.Group();
      this.scene.add(trajectoryGroup);
      const label = this.addLabel(NAMES[id], new THREE.Vector3(), {
        color: COLORS[id], size: 11, offset: [13, id === 'rbspa' ? -17 : 18], probe: id,
      });
      label.element.style.fontWeight = '600';
      label.element.style.textShadow = '0 1px 6px #06111e, 0 0 4px #06111e';
      this.probes[id] = { group, trajectoryGroup, label, position: null };
    }
  }

  addLabel(text, position, options = {}) {
    const element = document.createElement('div');
    element.textContent = text;
    element.style.cssText = `position:absolute;left:0;top:0;white-space:nowrap;line-height:1.2;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:${options.size || 11}px;color:${options.color || '#91a4b7'};will-change:transform;`;
    this.overlay.append(element);
    const label = { element, position, offset: options.offset || [8, -8], ...options };
    this.labels.push(label);
    return label;
  }

  setFrame(frame) {
    this.frame = typeof frame === 'string' ? frame : (frame?.name || frame?.id || 'GSE');
    for (const label of this.labels) {
      if (label.axis) label.element.title = `${this.frame} +${label.axis} axis`;
    }
    this.dirty = true;
  }

  setData({ series = {}, positions = {}, time, windowMs = 21600000, maxGapMs = DEFAULT_GAP_MS }) {
    const timestamp = time instanceof Date ? time.getTime() : Number(time);
    const halfWindow = Math.max(0, Number(windowMs) || 0);
    const gapLimit = Number.isFinite(maxGapMs) && maxGapMs > 0 ? maxGapMs : DEFAULT_GAP_MS;
    for (const id of IDS) {
      const probe = this.probes[id];
      const position = positions[id];
      probe.position = finiteSample(position) ? position : null;
      probe.group.visible = Boolean(probe.position && this.visibility[id]);
      if (probe.position) {
        probe.group.position.set(position.x, position.y, position.z);
        probe.label.position.copy(probe.group.position);
      }
      const samples = Array.isArray(series[id]) ? series[id] : [];
      const from = lowerBound(samples, timestamp - halfWindow);
      const to = lowerBound(samples, timestamp + halfWindow + 1);
      const split = lowerBound(samples, timestamp + 1);
      const previous = this.cache[id];
      if (!previous || previous.samples !== samples || previous.from !== from || previous.to !== to || previous.split !== split || previous.gapLimit !== gapLimit) {
        this.rebuildTrajectory(id, samples, from, to, split, gapLimit);
        this.cache[id] = { samples, from, to, split, gapLimit };
      }
    }
    this.dirty = true;
  }

  rebuildTrajectory(id, samples, from, to, split, gapLimit) {
    const group = this.probes[id].trajectoryGroup;
    for (const child of [...group.children]) {
      child.geometry.dispose();
      child.material.dispose();
      group.remove(child);
    }
    const past = [], future = [];
    for (let i = from + 1; i < to; i++) {
      const a = samples[i - 1], b = samples[i];
      if (!finiteSample(a) || !finiteSample(b)) continue;
      const dt = b.t - a.t;
      // Do not bridge missing samples, duplicates, or backward timestamps.
      if (dt <= 0 || dt > gapLimit) continue;
      const vertices = i < split ? past : future;
      vertices.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    for (const [vertices, isFuture] of [[past, false], [future, true]]) {
      if (!vertices.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      const material = isFuture
        ? new THREE.LineDashedMaterial({ color: COLORS[id], transparent: true, opacity: 0.45, dashSize: 0.09, gapSize: 0.065, depthWrite: false })
        : new THREE.LineBasicMaterial({ color: COLORS[id], transparent: true, opacity: 0.9, depthWrite: false });
      const segments = new THREE.LineSegments(geometry, material);
      if (isFuture) segments.computeLineDistances();
      group.add(segments);
    }
    group.visible = this.visibility[id];
  }

  setVisibility(id, visible) {
    if (!this.probes[id]) return;
    this.visibility[id] = Boolean(visible);
    this.probes[id].group.visible = Boolean(visible && this.probes[id].position);
    this.probes[id].trajectoryGroup.visible = Boolean(visible);
    this.dirty = true;
  }

  setView(view) {
    this.controls.target.set(0, 0, 0);
    this.camera.up.set(0, 0, 1);
    if (view === 'xy') this.camera.position.set(0, -0.0001, 18);
    else if (view === 'xz') this.camera.position.set(0, -18, 0.0001);
    else this.camera.position.set(7, -9, 13);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
    this.dirty = true;
  }

  resetView() { this.setView('oblique'); }

  resize() {
    this.width = Math.max(1, this.container.clientWidth);
    this.height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = this.width / this.height;
    // Preserve horizontal context on narrow screens without changing data or camera target.
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(43 / 2)) / Math.min(1, this.camera.aspect)));
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
    this.dirty = true;
  }

  earthOccludes(point) {
    // Is the center of the 1 R_E Earth closer than the spacecraft along its sightline?
    this.toPoint.copy(point).sub(this.camera.position);
    const distance = this.toPoint.length();
    if (!distance) return false;
    this.toPoint.divideScalar(distance);
    const along = -this.camera.position.dot(this.toPoint);
    if (along <= 0 || along >= distance) return false;
    return this.camera.position.lengthSq() - along * along < 1;
  }

  updateLabels() {
    for (const label of this.labels) {
      if (label.probe && (!this.visibility[label.probe] || !this.probes[label.probe].position || this.earthOccludes(label.position))) {
        label.element.style.display = 'none';
        continue;
      }
      this.projected.copy(label.position).project(this.camera);
      const x = (this.projected.x + 1) * this.width / 2 + label.offset[0];
      const y = (1 - this.projected.y) * this.height / 2 + label.offset[1];
      const visible = this.projected.z > -1 && this.projected.z < 1 && x > 4 && x < this.width - 45 && y > 4 && y < this.height - 95;
      label.element.style.display = visible ? 'block' : 'none';
      if (visible) label.element.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
    }
  }

  animate() {
    if (this.disposed) return;
    this.controls.update();
    if (this.dirty) {
      this.renderer.render(this.scene, this.camera);
      this.updateLabels();
      this.dirty = false;
    }
    this.animationId = requestAnimationFrame(this.animate);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.animationId);
    this.resizeObserver.disconnect();
    this.controls.removeEventListener('change', this.onChange);
    this.controls.dispose();
    this.scene.traverse(object => {
      object.geometry?.dispose();
      if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
      else object.material?.dispose();
    });
    this.glowTexture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.overlay.remove();
  }
}
