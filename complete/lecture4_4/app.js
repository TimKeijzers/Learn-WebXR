import * as THREE from '../../libs/three124/three.module.js';
import { GLTFLoader } from '../../libs/three124/jsm/GLTFLoader.js';
import { DRACOLoader } from '../../libs/three124/jsm/DRACOLoader.js';

class App {
  constructor() {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // Config
    this.SCALE = 0.5;       // schaal voor zowel viewer als AR
    this.MODEL_Y = 0.65;    // één vaste Y-hoogte voor viewer en als offset in AR

    // State
    this.clock = new THREE.Clock();
    this.animations = {};
    this.nameMap = { staan: 'Idle', dansen: 'Dance', doodgaan: 'Die', lopen: 'Walk' };
    this.currentAction = null;
    this.mixer = null;
    this.model = null;
    this.modelPlaced = false;

    // Camera/scene
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 1000);
    this.camera.position.set(0, 1.6, 3);

    this.scene = new THREE.Scene();
    this.sceneBGColor = 0x202020;                      // non-AR achtergrond
    this.scene.background = new THREE.Color(this.sceneBGColor);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
    hemi.position.set(0, 20, 0);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(3, 10, 10);
    this.scene.add(dir);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.xr.enabled = true; // WebXR enabled
    // Helpt om touch-gestures niet te interfereren
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    // Reticle (hit-test target in AR)
    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.14, 0.18, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    // XR controller: tap = select
    this.controller = this.renderer.xr.getController(0);
    this.controller.addEventListener('select', () => this.onSelect());
    this.scene.add(this.controller);

    // UI
    this.hintEl = document.getElementById('hint');
    this.setupButtons();
    this.makeARButton();

    // Events
    this.renderer.xr.addEventListener('sessionstart', () => this.onSessionStart());
    this.renderer.xr.addEventListener('sessionend', () => this.onSessionEnd());
    window.addEventListener('resize', () => this.onResize());

    // Load model & start loop
    this.loadGLTF('knight');
    this.renderer.setAnimationLoop((t, frame) => this.render(t, frame));

    // --- Debug: live nudge MODEL_Y with +/- and re-apply lift in viewer ---
    window.addEventListener('keydown', (e) => {
      if (e.key === '+' || e.key === '=') { this.MODEL_Y += 0.02; this.applyViewerLift(); }
      if (e.key === '-' || e.key === '_') { this.MODEL_Y -= 0.02; this.applyViewerLift(); }
    });

    // --- Drag-to-rotate (both viewer and AR) ---
    this._dragging = false;
    this._lastX = 0;
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => {
      // Ignore drags when user taps on UI buttons
      const path = e.composedPath?.() || [];
      if (path.some(el => el instanceof HTMLElement && el.id === 'btns')) return;
      this._dragging = true; this._lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this._dragging || !this.model) return;
      const dx = e.clientX - this._lastX;
      this._lastX = e.clientX;
      // rotate around Y
      this.model.rotation.y += dx * 0.005;
    });
    canvas.addEventListener('pointerup', (e) => {
      this._dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch(_) {}
    });
    canvas.addEventListener('pointercancel', () => { this._dragging = false; });
  }

  setupButtons() {
    const onClick = (e) => {
      const label = e.currentTarget.innerHTML.trim();
      const mapped =
        (this.animations && this.animations[label]) ? label :
        (this.nameMap && this.nameMap[label] && this.animations[this.nameMap[label]])
          ? this.nameMap[label]
          : (this.animations ? Object.keys(this.animations)[0] : undefined);
      if (mapped) this.playAction(mapped);
    };
    for (let i = 1; i <= 4; i++) {
      const btn = document.getElementById(`btn${i}`);
      if (btn) btn.addEventListener('click', onClick);
    }
  }

  loadGLTF(filename) {
    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('../../libs/three124/jsm/draco/'); // jouw repo
    loader.setDRACOLoader(dracoLoader);

    loader.load(
      `${filename}.glb`,
      (gltf) => {
        gltf.animations.forEach((anim) => { this.animations[anim.name] = anim; });
        console.log('GLB animations found:', Object.keys(this.animations));

        this.model = gltf.scene;
        // Voorkom dat meshes wegclippen
        this.model.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
        this.scene.add(this.model);

        this.mixer = new THREE.AnimationMixer(this.model);

        // Zichtbaar in non-AR viewer; schaal en basispositie
        this.model.scale.setScalar(this.SCALE);
        this.model.visible = true;

        // Compute bounding box AFTER scaling, so we can align the base to MODEL_Y
        const box = new THREE.Box3().setFromObject(this.model);
        this._modelBaseY = box.min.y; // already in scaled space
        this.applyViewerLift();

        const defaultLabel = 'staan';
        const defaultName =
          this.animations[defaultLabel] ? defaultLabel :
          (this.nameMap[defaultLabel] && this.animations[this.nameMap[defaultLabel]])
            ? this.nameMap[defaultLabel]
            : Object.keys(this.animations)[0];
        if (defaultName) this.playAction(defaultName);
      },
      undefined,
      (err) => console.error('GLTF load error for', `${filename}.glb`, err)
    );
  }

  applyViewerLift() {
    if (!this.model || this._modelBaseY == null) return;
    const lift = -this._modelBaseY + this.MODEL_Y; // Box3 is already scaled
    this.model.position.set(0, lift, 0);
    console.log('[lift] MODEL_Y:', this.MODEL_Y, 'baseY:', this._modelBaseY, 'applied lift:', lift);
  }

  playAction(name) {
    const clip =
      this.animations?.[name] ||
      (this.nameMap?.[name] ? this.animations[this.nameMap[name]] : undefined);
    if (!clip || !this.mixer) return;

    const action = this.mixer.clipAction(clip);
    if (this.currentAction && this.currentAction !== action) {
      this.currentAction.crossFadeTo(action, 0.35, false);
    }
    if (name === 'doodgaan' || name === 'Die') {
      action.loop = THREE.LoopOnce;
      action.clampWhenFinished = true;
    }
    action.reset().play();
    this.currentAction = action;
  }

  makeARButton() {
    const btns = document.getElementById('btns');
    if (!btns) return;

    // Always create the button so it's visible; then enable/disable based on support
    const btn = document.createElement('button');
    btn.id = 'btnAR';
    btn.textContent = 'Enter AR';
    btn.style.marginLeft = '6px';
    btn.disabled = false;
    btn.title = '';
    btn.addEventListener('click', () => this.startAR());
    btns.appendChild(btn);

    if (!('xr' in navigator)) {
      btn.disabled = true;
      btn.title = 'WebXR niet beschikbaar in deze browser';
      return;
    }
    navigator.xr.isSessionSupported('immersive-ar')
      .then((supported) => {
        btn.disabled = !supported;
        btn.title = supported ? '' : 'WebXR AR wordt niet ondersteund op dit toestel';
      })
      .catch(() => { /* leave defaults */ });
  }

  startAR() {
    if (!('xr' in navigator)) {
      console.warn('WebXR niet beschikbaar in deze browser.');
      return;
    }
    if (this._startingAR) return;
    this._startingAR = true;

    const btn = document.getElementById('btnAR');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Start AR…';
    }

    const tryStart = (useDomOverlay) => {
      const sessionInit = {
        requiredFeatures: ['hit-test'],
        optionalFeatures: useDomOverlay ? ['dom-overlay'] : [],
        ...(useDomOverlay ? { domOverlay: { root: document.body } } : {})
      };

      return navigator.xr.requestSession('immersive-ar', sessionInit)
        .then((session) => {
          this.renderer.xr.setReferenceSpaceType('local');
          this.renderer.xr.setSession(session);
          this.hitTestSource = null;
          this.hitTestSourceRequested = false;
          const b = document.getElementById('btnAR');
          if (b) { b.disabled = true; b.textContent = 'AR actief'; }
        });
    };

    // Try WITHOUT overlay first (more reliable on some devices). If that fails, retry WITH overlay.
    tryStart(false)
      .catch((e) => {
        if (e && (e.name === 'NotSupportedError' || e.message?.toLowerCase().includes('overlay'))) {
          console.warn('AR zonder overlay faalde of overlay vereist — probeer met DOM overlay…');
          return tryStart(true);
        }
        console.error('AR start faalde:', e);
        throw e;
      })
      .catch((e) => {
        console.error('AR kon niet starten (fallback ook mislukt):', e);
        // Reset UI so the user can try again
        const b = document.getElementById('btnAR');
        if (b) { b.disabled = false; b.textContent = 'Enter AR'; }
        this._startingAR = false;
      });
  }


onSessionStart() {
  this._startingAR = false;
  if (this.hintEl) this.hintEl.style.display = 'block';

  // camera-feed tonen in AR
  this._prevBackground = this.scene.background;
  this.scene.background = null;

  this.reticle.visible = false;
  this.modelPlaced = false;
  if (this.model) this.model.visible = false;

  // Enter AR-knop status (optioneel)
  const enterBtn = document.getElementById('btnAR');
  if (enterBtn) { enterBtn.disabled = true; enterBtn.textContent = 'AR actief'; }

  // 👉 EXIT-AR KNOP MAKEN
  const btns = document.getElementById('btns');
  if (btns && !document.getElementById('btnExitAR')) {
    const exitBtn = document.createElement('button');
    exitBtn.id = 'btnExitAR';
    exitBtn.textContent = 'Exit AR';
    exitBtn.style.marginLeft = '6px';
    exitBtn.addEventListener('click', () => {
      const s = this.renderer.xr.getSession?.();
      if (s) s.end();
    });
    btns.appendChild(exitBtn);
  }
}

  onSessionEnd() {
    if (this.hintEl) this.hintEl.style.display = 'none';
    this.reticle.visible = false;
    this.hitTestSourceRequested = false;
    this.hitTestSource = null;

    // non-AR achtergrond terug
    this.scene.background = new THREE.Color(this.sceneBGColor);

    // Model terug in viewer-positie
    if (this.model) {
      this.model.visible = true;
      this.applyViewerLift();
    }

    // Enter AR-knop herstellen (optioneel)
    const enterBtn = document.getElementById('btnAR');
    if (enterBtn) { enterBtn.disabled = false; enterBtn.textContent = 'Enter AR'; }

    // 👉 EXIT-AR KNOP WEGHALEN
    const exitBtn = document.getElementById('btnExitAR');
    if (exitBtn && exitBtn.parentNode) {
      exitBtn.parentNode.removeChild(exitBtn);
    }
  }
  onSelect() {
    if (this.reticle.visible && this.model) {
      // Plaats op reticle + til een beetje op (Y is omhoog)
      const p = new THREE.Vector3().setFromMatrixPosition(this.reticle.matrix);
      const lift = -this._modelBaseY + this.MODEL_Y; // box is already scaled
      this.model.position.set(p.x, p.y + lift, p.z);
      this.model.visible = true;
      this.modelPlaced = true;
    }
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(t, frame) {
    const dt = this.clock.getDelta();
    if (this.mixer) this.mixer.update(dt);

    if (frame) {
      const session = this.renderer.xr.getSession();
      const refSpace = this.renderer.xr.getReferenceSpace();

      if (!this.hitTestSourceRequested) {
        session.requestReferenceSpace('viewer').then((viewerSpace) => {
          session.requestHitTestSource({ space: viewerSpace }).then((source) => {
            this.hitTestSource = source;
          });
        });
        session.addEventListener('end', () => {
          this.hitTestSourceRequested = false;
          this.hitTestSource = null;
        });
        this.hitTestSourceRequested = true;
      }

      if (this.hitTestSource) {
        const hits = frame.getHitTestResults(this.hitTestSource);
        if (hits.length) {
          const pose = hits[0].getPose(refSpace);
          this.reticle.visible = true;
          this.reticle.matrix.fromArray(pose.transform.matrix);
        } else {
          this.reticle.visible = false;
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}

new App();
export { App };
