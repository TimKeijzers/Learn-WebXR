import * as THREE from '../../libs/three124/three.module.js';
import { GLTFLoader } from '../../libs/three124/jsm/GLTFLoader.js';
import { DRACOLoader } from '../../libs/three124/jsm/DRACOLoader.js';


class App {
  constructor() {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // Config
    this.SCALE = 0.5;     // jouw gewenste schaal

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
        this.model.position.set(0, 5, 0);

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

    // Altijd renderen; enable/disable op basis van support
    const btn = document.createElement('button');
    btn.id = 'btnAR';
    btn.textContent = 'Enter AR';
    btn.style.marginLeft = '6px';
    btn.disabled = !('xr' in navigator);
    btn.title = btn.disabled ? 'WebXR niet beschikbaar in deze browser' : '';
    btn.addEventListener('click', () => this.startAR());
    btns.appendChild(btn);

    if ('xr' in navigator) {
      navigator.xr.isSessionSupported('immersive-ar')
        .then((supported) => {
          btn.disabled = !supported;
          btn.title = supported ? '' : 'WebXR AR wordt niet ondersteund op dit toestel';
        })
        .catch(() => {/* laat defaults */});
    }
  }

  startAR() {
    if (!('xr' in navigator)) {
      console.warn('[AR] WebXR niet beschikbaar in deze browser.');
      return;
    }
    if (this._startingAR) return;
    this._startingAR = true;

    const tryStart = (useDomOverlay) => {
      const sessionInit = {
        requiredFeatures: ['hit-test'],
        optionalFeatures: useDomOverlay ? ['dom-overlay'] : [],
        ...(useDomOverlay ? { domOverlay: { root: document.body } } : {})
      };
      console.log('[AR] requestSession, domOverlay =', useDomOverlay);

      // Pre-hide model to avoid showing the viewer model during transition
      if (this.model) this.model.visible = false;

      return navigator.xr.requestSession('immersive-ar', sessionInit)
        .then((session) => {
          console.log('[AR] session acquired');
          this.renderer.xr.setReferenceSpaceType('local');
          this.renderer.xr.setSession(session);
          // Switch to camera feed immediately to avoid black/solid frame
          this._prevBackground = this.scene.background;
          this.scene.background = null;
          this.hitTestSource = null;
          this.hitTestSourceRequested = false;
        });
    };

    // Try WITHOUT overlay first (most reliable for first-start on many devices)
    tryStart(false)
      .catch((e) => {
        console.warn('[AR] first start (no overlay) failed:', e?.name || e);
        if (e && (e.name === 'NotSupportedError' || String(e.message || '').toLowerCase().includes('overlay'))) {
          console.log('[AR] retry with dom-overlay…');
          return tryStart(true);
        }
        throw e;
      })
      .catch((e) => {
        console.error('[AR] could not start AR after retry:', e);
        this._startingAR = false;
        if (this.model) { this.model.visible = true; this.model.position.set(0, 5, 0); }
      });
  }

  onSessionStart() {
    this._startingAR = false;
    if (this.hintEl) this.hintEl.style.display = 'block';

    // Ensure we use camera feed during AR
    this._prevBackground = this._prevBackground ?? this.scene.background;
    this.scene.background = null;

    this.reticle.visible = false;
    this.modelPlaced = false;

    // Hide model until user places it
    if (this.model) this.model.visible = false;

    // Only show Exit AR button if dom-overlay is actually active
    const sess = this.renderer.xr.getSession?.();
    const hasOverlay = !!(sess && sess.domOverlayState && sess.domOverlayState.type);
    if (hasOverlay) {
      const btns = document.getElementById('btns');
      if (btns && !document.getElementById('btnExitAR')) {
        const exitBtn = document.createElement('button');
        exitBtn.id = 'btnExitAR';
        exitBtn.textContent = 'Exit AR';
        exitBtn.style.marginLeft = '6px';
        exitBtn.addEventListener('click', () => { const s = this.renderer.xr.getSession?.(); if (s) s.end(); });
        btns.appendChild(exitBtn);
      }
    }
  }

  onSessionEnd() {
    if (this.hintEl) this.hintEl.style.display = 'none';
    this.reticle.visible = false;
    this.hitTestSourceRequested = false;
    this.hitTestSource = null;

    // Restore non-AR background
    this.scene.background = new THREE.Color(this.sceneBGColor);

    // Show model again in the viewer at (0, 5, 0)
    if (this.model) {
      this.model.visible = true;
      this.model.position.set(0, 5, 0);
    }

    // Remove Exit AR button if present
    const exitBtn = document.getElementById('btnExitAR');
    if (exitBtn && exitBtn.parentNode) exitBtn.parentNode.removeChild(exitBtn);

    this._startingAR = false;
  }

  onSelect() {
    if (this.reticle.visible && this.model) {
      // Plaats exact op de reticle-positie (simpel)
      const p = new THREE.Vector3().setFromMatrixPosition(this.reticle.matrix);
      this.model.position.copy(p);
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
        console.log('[AR] creating hit test source');
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
