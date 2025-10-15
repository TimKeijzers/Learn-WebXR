import * as THREE from '../../libs/three124/three.module.js';
import { GLTFLoader } from '../../libs/three124/jsm/GLTFLoader.js';
import { DRACOLoader } from '../../libs/three124/jsm/DRACOLoader.js';

class App {

  constructor() {
    this.container = document.createElement('div');
    document.body.appendChild(this.container);

    this.clock = new THREE.Clock();

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, 1.5, 3);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x202020);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
    hemiLight.position.set(0, 20, 0);
    this.scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(3, 10, 10);
    this.scene.add(dirLight);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.container.appendChild(this.renderer.domElement);

    this.loadGLTF('knight');
    this.addButtonEvents();

    window.addEventListener('resize', this.onWindowResize.bind(this));
    this.animate();
  }

  loadGLTF(filename){
    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();

    // Matches your repo structure
    dracoLoader.setDecoderPath('../../libs/three124/jsm/draco/');
    loader.setDRACOLoader(dracoLoader);

    loader.load(
      `${filename}.glb`,
      (gltf) => {
        this.animations = {};
        // Map Dutch button labels → likely clip names
        this.nameMap = {
          'staan': 'Idle',
          'dansen': 'Dance',
          'doodgaan': 'Die',
          'lopen': 'Walk'
        };

        gltf.animations.forEach((anim) => {
          this.animations[anim.name] = anim;
        });
        console.log('GLB animations found:', gltf.animations.map(a => a.name));

        this.model = gltf.scene;
        this.scene.add(this.model);

        this.mixer = new THREE.AnimationMixer(this.model);

        const scale = 0.01; // adjust if needed
        this.model.scale.set(scale, scale, scale);

        // Choose a safe default action
        const defaultLabel = 'staan';
        const defaultName = this.animations[defaultLabel]
          ? defaultLabel
          : (this.nameMap[defaultLabel] && this.animations[this.nameMap[defaultLabel]]
              ? this.nameMap[defaultLabel]
              : Object.keys(this.animations)[0]);

        if (defaultName) this.playAction(defaultName);
      },
      (xhr) => {
        // progress if needed: console.log(xhr.loaded / xhr.total);
      },
      (error) => {
        console.error('GLTF load error for', `${filename}.glb`, error);
      }
    );
  }

  playAction(name){
    const clip =
      this.animations?.[name] ||
      (this.nameMap?.[name] ? this.animations[this.nameMap[name]] : undefined);

    if (!clip || !this.mixer) return;

    if (this.currentAction) this.currentAction.stop();
    this.currentAction = this.mixer.clipAction(clip);

    // One-shot for “doodgaan/Die”
    if (name === 'doodgaan' || name === 'Die') {
      this.currentAction.loop = THREE.LoopOnce;
      this.currentAction.clampWhenFinished = true;
    }

    this.currentAction.reset().play();
  }

  addButtonEvents(){
    const onClick = (e) => {
      const label = e.currentTarget.innerHTML.trim();
      const mapped =
        (this.animations && this.animations[label])
          ? label
          : (this.nameMap && this.nameMap[label] && this.animations[this.nameMap[label]]
              ? this.nameMap[label]
              : (this.animations ? Object.keys(this.animations)[0] : undefined));
      if (mapped) this.playAction(mapped);
    };

    for (let i = 1; i <= 4; i++){
      const btn = document.getElementById(`btn${i}`);
      if (btn) btn.addEventListener('click', onClick);
    }
  }

  onWindowResize(){
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  animate(){
    requestAnimationFrame(this.animate.bind(this));
    const dt = this.clock.getDelta();
    if (this.mixer) this.mixer.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}

new App();
export { App };
