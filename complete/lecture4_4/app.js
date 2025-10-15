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
    this.renderer.xr.enabled = true; // belangrijk voor WebXR
    container.appendChild(this.renderer.domElement);

    // OrbitControls (non-AR)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1, 0);
    this.controls.update();

    // Stats + Loading
    this.stats = new Stats();
    document.body.appendChild(this.stats.dom);
    this.loadingBar = new LoadingBar();

    // HDR-omgeving (werkt ook non-AR)
    this.setEnvironment();

    // AR UI (hint + knop)
    this.hint = this.makeHint('Beweeg je telefoon om een vlak te vinden. Tik om te plaatsen.');
    this.hint.hidden = true;
    this.makeARButton(); // maakt en voegt "Enter AR" toe aan #btns indien ondersteund

    // Reticle voor hit-test
    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.14, 0.18, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    // Controller (tap/select) om te plaatsen
    this.controller = this.renderer.xr.getController(0);
    this.controller.addEventListener('select', () => this.onSelect());
    this.scene.add(this.controller);

    // Event listeners
    this.renderer.xr.addEventListener('sessionstart', () => this.onSessionStart());
    this.renderer.xr.addEventListener('sessionend', () => this.onSessionEnd());
    window.addEventListener('resize', this.resize.bind(this));

    // Init scene (laad model + knoppen)
    this.initScene();

    // Render loop
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
    this.loadGLTF('knight');
  }

  // --- Animatiekeuze setter (gebruikt mapping) ---
  set action(name) {
    if (this.actionName === name) return;

    // Ondersteun direct label óf gemapte naam
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
      // probeer label direct, anders mapping, anders fallback 1e clip
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
    // Belangrijk: pad naar jouw DRACO decoders bij three124
    dracoLoader.setDecoderPath('../../libs/three124/jsm/draco/');
    loader.setDRACOLoader(dracoLoader);

    loader.load(
      `${filename}.glb`,
      (gltf) => {
        // Animaties indexeren
        this.animations = {};
        gltf.animations.forEach((anim) => {
          this.animations[anim.name] = anim;
        });
        console.log('GLB animations found:', gltf.animations.map((a) => a.name));

        // Model referentie
        this.knight = gltf.scene;
        this.knight.visible = true; // in non-AR tonen
        this.scene.add(this.knight);

        // Mixer
        this.mixer = new THREE.AnimationMixer(this.knight);

        // schaal (pas aan indien nodig)
        const scale = 0.01;
        this.knight.scale.set(scale, scale, scale);

        // Buttons activeren
        this.addButtonEvents();

        // Default actie kiezen (robuust)
        const defaultLabel = 'staan';
        const defaultName = this.animations[defaultLabel]
          ? defaultLabel
          : (this.nameMap && this.animations[this.nameMap[defaultLabel]]
              ? this.nameMap[defaultLabel]
              : Object.keys(this.animations)[0]);
        if (defaultName) this.action = defaultName;

        // Loading klaar
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

  // ====== AR Helpers ======
  makeHint(text) {
    const div = document.createElement('div');
    div.textContent = text;
    Object.assign(div.style, {
      position: 'absolute',
      left: '50%',
      transform: 'translateX(-50%)',
      bottom: '14px',
      zIndex: '10',
      color: 'white',
      fontFamily: 'system-ui, Arial, sans-serif',
      fontSize: '14px',
      padding: '6px 10px',
      background: 'rgba(0,0,0,0.5)',
      borderRadius: '8px'
    });
    document.body.appendChild(div);
    return div;
    }

  makeARButton() {
    const btns = document.getElementById('btns');
    if (!btns || !navigator.xr) return; // geen XR beschikbaar

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
    // Start een AR-sessie met hit-test
    const sessionInit = { requiredFeatures: ['hit-test'] };
    navigator.xr
      .requestSession('immersive-ar', sessionInit)
      .then((session) => {
        this.renderer.xr.setReferenceSpaceType('local');
        this.renderer.xr.setSession(session);

        // hit-test bron instellen
        this.hitTestSource = null;
        this.hitTestSourceRequested = false;
      })
      .catch((e) => {
        console.error('AR session request failed:', e);
      });
  }

  onSessionStart() {
    this.hint.hidden = false;
    this.reticle.visible = false;
    this.modelPlaced = false;
    // OrbitControls “uit” gevoel (non-AR) — je kunt ze aan laten, ze doen niets in AR
  }

  onSessionEnd() {
    this.hint.hidden = true;
    this.reticle.visible = false;
    this.hitTestSourceRequested = false;
    this.hitTestSource = null;
    // Model zichtbaar laten in non-AR preview op (0,0,0):
    if (this.knight) {
      this.knight.visible = true;
      this.knight.position.set(0, 0, 0);
    }
  }

  onSelect() {
    // Tik om te plaatsen
    if (this.reticle.visible && this.knight) {
      this.knight.visible = true;
      this.knight.position.setFromMatrixPosition(this.reticle.matrix);
      this.modelPlaced = true;
    }
  }

  // ====== Render & Resize ======
  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(timestamp, frame) {
    const dt = this.clock.getDelta();
    this.stats.update();
    if (this.mixer) this.mixer.update(dt);

    // AR hit-test update
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
