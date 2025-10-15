import * as THREE from '../../libs/three124/three.module.js';
import { GLTFLoader } from '../../libs/three124/jsm/GLTFLoader.js';
import { DRACOLoader } from '../../libs/three124/jsm/DRACOLoader.js';
// Optioneel: HDR omgeving uitschakelen om grijs-scherm issues te vermijden tijdens debug

class App {
  constructor() {
    const container = document.createElement('div');
    document.body.appendChild(container);

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
    this.scene.background = new THREE.Color(0x202020);

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
    this.renderer.xr.enabled = true;
    // Belangrijk voor touch-handling in AR
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    // Reticle (voor AR)
    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.14, 0.18, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    // XR controller: tik = select
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
    dracoLoader.setDecoderPath('../../libs/three124/jsm/draco/');
    loader.setDRACOLoader(dracoLoader);

    loader.load(
      `${filename}.glb`,
      (gltf) => {
        // Animaties indexeren
        gltf.animations.forEach((anim) => { this.animations[anim.name] = anim; });
        console.log('GLB animations found:', Object.keys(this.animations));

        // Model
        this.model = gltf.scene;
        // Zorg dat niets per ongeluk uit culling valt
        this.model.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
        this.scene.add(this.model);

        // Mixer
        this.mixer = new THREE.AnimationMixer(this.model);

        // SCHAAL: maak ‘m zichtbaar in viewer; pas desnoods aan
        const SCALE = 0.2; // was 0.01: vaak te klein → niets te zien
        this.model.scale.setScalar(SCALE);

        // Zet model in non-AR viewer op (0,0,0) zichtbaar
        this.model.visible = true;
        this.model.position.set(0, 0, 0);

        // Default animatie
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
    if (!btns || !navigator.xr) return;
    navigator.xr.isSessionSupported('immersive-ar').then((ok) => {
      if (!ok) return;
      const btn = document.createElement('button');
      btn.id = 'btnAR';
      btn.textContent = 'Enter AR';
      btn.style.marginLeft = '6px';
      btn.addEventListener('click', () => this.startAR());
      btns.appendChild(btn);
    });
  }

  startAR() {
    // Tip: als camera-permissie eerder is geweigerd: site-instellingen → Camera toestaan voor timkeijzers.github.io
    const init = { requiredFeatures: ['hit-test'] };
    navigator.xr.requestSession('immersive-ar', init).then((session) => {
      this.renderer.xr.setReferenceSpaceType('local');
      this.renderer.xr.setSession(session);

      // Laat taps niet “vastlopen” op UI tijdens AR
      const btns = document.getElementById('btns');
      if (btns) btns.style.pointerEvents = 'none';

      this.hitTestSource = null;
      this.hitTestSourceRequested = false;
    }).catch((e) => {
      console.error('AR session request failed:', e);
      alert('AR kon niet starten. Controleer camera-toestemming en ARCore/Play Services for AR.');
    });
  }

  onSessionStart() {
    console.log('[XR] sessionstart');
    if (this.hintEl) this.hintEl.style.display = 'block';
    this.reticle.visible = false;
    this.modelPlaced = false;

    // Verberg model bij AR start tot we hem plaatsen
    if (this.model) this.model.visible = false;
  }

  onSessionEnd() {
    console.log('[XR] sessionend');
    if (this.hintEl) this.hintEl.style.display = 'none';
    this.reticle.visible = false;
    this.hitTestSourceRequested = false;
    this.hitTestSource = null;

    // UI weer klikbaar
    const btns = document.getElementById('btns');
    if (btns) btns.style.pointerEvents = 'auto';

    // Toon model weer in viewer
    if (this.model) {
      this.model.visible = true;
      this.model.position.set(0, 0, 0);
    }
  }

  onSelect() {
    console.log('[XR] select');
    if (this.reticle.visible && this.model) {
      this.model.visible = true;
      this.model.position.setFromMatrixPosition(this.reticle.matrix);
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

    // Hit-test (AR)
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
