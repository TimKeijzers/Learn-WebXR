import * as THREE from '../../libs/three124/three.module.js';
import { GLTFLoader } from '../../libs/three124/jsm/GLTFLoader.js';
import { DRACOLoader } from '../../libs/three124/jsm/DRACOLoader.js';
import { RGBELoader } from '../../libs/three124/jsm/RGBELoader.js';
import { LoadingBar } from '../../libs/LoadingBar.js';
import { Stats } from '../../libs/stats.module.js';
import { OrbitControls } from '../../libs/three124/jsm/OrbitControls.js';

class App {
  constructor() {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // Timers & state
    this.clock = new THREE.Clock();
    this.animations = {};
    this.nameMap = { staan: 'Idle', dansen: 'Dance', doodgaan: 'Die', lopen: 'Walk' };
    this.actionName = undefined;
    this.curAction = undefined;
    this.mixer = undefined;
    this.modelPlaced = false;

    // Camera & Scene
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 1000);
    this.camera.position.set(0, 1.6, 3);
    this.camera.lookAt(0, 0, 0);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x505050);

    this.scene.add(new THREE.HemisphereLight(0x606060, 0x404040));
    const light = new THREE.DirectionalLight(0xffffff, 0.8);
    light.position.set(1, 2, 1).normalize();
    this.scene.add(light);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.xr.enabled = true; // WebXR
    container.appendChild(this.renderer.domElement);

    // OrbitControls (non-AR)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1, 0);
    this.controls.update();

    // Stats + Loading
    this.stats = new Stats();
    document.body.appendChild(this.stats.dom);
    this.loadingBar = new LoadingBar();

    // HDR-omgeving
    this.setEnvironment();

    // Hook AR UI (hint + WebXR button)
    this.hintEl = document.getElementById('hint');
    this.makeARButton(); // adds "Enter AR" next to your other buttons when supported

    // Reticle (for WebXR hit-test)
    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.14, 0.18, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    // Controller (tap/select) to place
    this.controller = this.renderer.xr.getController(0);
    this.controller.addEventListener('select', () => this.onSelect());
    this.scene.add(this.controller);

    // Events
    this.renderer.xr.addEventListener('sessionstart', () => this.onSessionStart());
    this.renderer.xr.addEventListener('sessionend', () => this.onSessionEnd());
    window.addEventListener('resize', this.resize.bind(this));

    // Load model + buttons
    this.initScene();

    // Loop
    this.renderer.setAnimationLoop(this.render.bind(this));
  }

  setEnvironment() {
    const loader = new RGBELoader().setDataType(THREE.UnsignedByteType);
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();

    loader.load(
      '../../assets/hdr/venice_sunset_1k.hdr',
      (texture) => {
        const envMap = pmremGenerator.fromEquirectangular(texture).texture;
        pmremGenerator.dispose();
        this.scene.environment = envMap;
      },
      undefined,
      () => console.error('An error occurred setting the environment')
    );
  }

  initScene() {
    this.loadGLTF('knight'); // expects knight.glb next to this file
  }

  // Animatiekeuze (NL labels → echte clipnamen)
  set action(name) {
    if (this.actionName === name) return;

    const resolved =
      this.animations[name] ||
      (this.nameMap[name] ? this.animations[this.nameMap[name]] : undefined);

    if (!resolved) return;

    const action = this.mixer.clipAction(resolved);

    if (name === 'doodgaan' || name === 'Die') {
      action.loop = THREE.LoopOnce;
      action.clampWhenFinished = true;
    }

    this.actionName = name;
    if (this.curAction) this.curAction.crossFadeTo(action, 0.5, false);

    action.enabled = true;
    action.play();
    this.curAction = action;
  }

  addButtonEvents() {
    const self = this;
    function onClick() {
      const label = this.innerHTML.trim();
      const mapped =
        (self.animations && self.animations[label])
          ? label
          : (self.nameMap && self.nameMap[label] && self.animations[self.nameMap[label]]
              ? self.nameMap[label]
              : (self.animations ? Object.keys(self.animations)[0] : undefined));
      if (mapped) self.action = mapped;
    }
    for (let i = 1; i <= 4; i++) {
      const btn = document.getElementById(`btn${i}`);
      if (btn) btn.addEventListener('click', onClick);
    }
  }

  loadGLTF(filename) {
    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('../../libs/three124/jsm/draco/'); // matches your repo
    loader.setDRACOLoader(dracoLoader);

    loader.load(
      `${filename}.glb`,
      (gltf) => {
        this.animations = {};
        gltf.animations.forEach((anim) => { this.animations[anim.name] = anim; });
        console.log('GLB animations found:', gltf.animations.map((a) => a.name));

        this.knight = gltf.scene;
        this.knight.visible = true; // visible in non-AR
        this.scene.add(this.knight);

        this.mixer = new THREE.AnimationMixer(this.knight);

        const scale = 0.01; // tweak if needed
        this.knight.scale.set(scale, scale, scale);

        this.addButtonEvents();

        const defaultLabel = 'staan';
        const defaultName = this.animations[defaultLabel]
          ? defaultLabel
          : (this.nameMap && this.animations[this.nameMap[defaultLabel]]
              ? this.nameMap[defaultLabel]
              : Object.keys(this.animations)[0]);
        if (defaultName) this.action = defaultName;

        this.loadingBar.visible = false;
      },
      (xhr) => {
        this.loadingBar.progress = xhr.total ? xhr.loaded / xhr.total : 0.1;
      },
      (error) => {
        console.error('GLTF load error for', `${filename}.glb`, error);
      }
    );
  }

  // ---------- WebXR AR helpers ----------
  makeARButton() {
    const btns = document.getElementById('btns');
    if (!btns || !navigator.xr) return;

    navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
      if (!supported) return;

      const btn = document.createElement('button');
      btn.id = 'btnAR';
      btn.textContent = 'Enter AR';
      btn.style.marginLeft = '6px';
      btn.addEventListener('click', () => this.startAR());
      btns.appendChild(btn);
    });
  }

  startAR() {
    const sessionInit = { requiredFeatures: ['hit-test'] };
    navigator.xr.requestSession('immersive-ar', sessionInit)
      .then((session) => {
        this.renderer.xr.setReferenceSpaceType('local');
        this.renderer.xr.setSession(session);
        this.hitTestSource = null;
        this.hitTestSourceRequested = false;
      })
      .catch((e) => console.error('AR session request failed:', e));
  }

  onSessionStart() {
    if (this.hintEl) this.hintEl.style.display = 'block';
    this.reticle.visible = false;
    this.modelPlaced = false;
  }

  onSessionEnd() {
    if (this.hintEl) this.hintEl.style.display = 'none';
    this.reticle.visible = false;
    this.hitTestSourceRequested = false;
    this.hitTestSource = null;
    if (this.knight) {
      this.knight.visible = true;
      this.knight.position.set(0, 0, 0);
    }
  }

  onSelect() {
    if (this.reticle.visible && this.knight) {
      this.knight.visible = true;
      this.knight.position.setFromMatrixPosition(this.reticle.matrix);
      this.modelPlaced = true;
    }
  }

  // ---------- Render & Resize ----------
  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(timestamp, frame) {
    const dt = this.clock.getDelta();
    this.stats.update();
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
        const hitTestResults = frame.getHitTestResults(this.hitTestSource);
        if (hitTestResults.length) {
          const hit = hitTestResults[0];
          const pose = hit.getPose(refSpace);
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

export { App };
