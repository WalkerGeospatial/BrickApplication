/**
 * renderer3d.js
 * Three.js scene rendering a single 32×32 baseplate elevation map.
 *
 * Uses InstancedMesh for both brick bodies and studs to keep draw calls low
 * (1024 bricks + 4096 studs = 2 draw calls total instead of 5120+).
 *
 * Scale: 1 world unit = 1 stud width (8 mm physical)
 *        PLATE_H = 0.4 units = 3.2 mm physical (one plate)
 */

class Renderer3D {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.scene     = null;
    this.camera    = null;
    this.renderer  = null;
    this.controls  = null;
    this._raf      = null;
    this._built    = false;
    this._camDist  = 30;   // updated in build(), used by resetCamera()
    // stored so we can dispose on rebuild
    this._brickMesh  = null;
    this._studMesh   = null;
    this._baseMesh   = null;
    // colour editing
    this._colors       = null;   // hex string per instance, mirrors mesh colours
    this._highlightIdx = null;
    this._outlineMesh  = null;
    this._raycaster    = new THREE.Raycaster();
  }

  // ── Init ────────────────────────────────────────────────────────────────

  init() {
    const W = this.container.clientWidth;
    const H = this.container.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f1117);
    this.scene.fog = new THREE.Fog(0x0f1117, 60, 120);

    this.camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 300);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(W, H);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping  = true;
    this.controls.dampingFactor  = 0.06;
    this.controls.minDistance    = 2;
    this.controls.maxDistance    = 120;
    this.controls.maxPolarAngle  = Math.PI / 2.05;

    this._setupLighting();
    this._animate();
  }

  _setupLighting() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    const sun = new THREE.DirectionalLight(0xfff4e0, 1.0);
    sun.position.set(20, 35, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    // Shadow frustum covers the whole 32×32 baseplate
    sun.shadow.camera.left   = -20;
    sun.shadow.camera.right  =  20;
    sun.shadow.camera.top    =  20;
    sun.shadow.camera.bottom = -20;
    sun.shadow.camera.near   =  1;
    sun.shadow.camera.far    = 100;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0xa0c8ff, 0.35);
    fill.position.set(-10, 8, -15);
    this.scene.add(fill);
  }

  _animate() {
    this._raf = requestAnimationFrame(() => this._animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const W = this.container.clientWidth;
    const H = this.container.clientHeight;
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(W, H);
  }

  // ── Build ────────────────────────────────────────────────────────────────

  /**
   * @param {number[][]} plateGrid  [row][col] — integer plate count per stud
   * @param {string[][]} colorGrid  [row][col] — hex colour string per stud
   */
  build(plateGrid, colorGrid) {
    this._clearScene();

    const ROWS = plateGrid.length;   // 32
    const COLS = plateGrid[0].length; // 32
    const N    = ROWS * COLS;         // 1024

    // Physical brick ratios (in stud units where 1 unit = 8 mm)
    const CELL    = 1;      // stud pitch
    const GAP     = 0.04;   // thin gap between studs for visual separation
    const PLATE_H = 0.4;    // one plate = 3.2 mm = 0.4 stud units
    const STUD_R  = 0.24;   // stud radius (4.8 mm / 2 / 8 mm ≈ 0.3, slightly smaller for clarity)
    const STUD_H  = 0.225;  // stud protrusion (1.8 mm / 8 mm)

    const maxH = Math.max(...plateGrid.flat()) * PLATE_H;

    // ── Shared geometries ──────────────────────────────────────────────────
    // Brick body: unit cube, will be scaled per-instance on Y
    const brickGeo = new THREE.BoxGeometry(CELL - GAP, 1, CELL - GAP);

    // Stud: one per stud position (exactly one stud per cell on a 32×32 plate)
    const studGeo = new THREE.CylinderGeometry(STUD_R, STUD_R, STUD_H, 12);

    const brickMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.0 });
    const studMat  = new THREE.MeshStandardMaterial({ roughness: 0.40, metalness: 0.0 });

    // ── Instanced meshes ───────────────────────────────────────────────────
    this._brickMesh = new THREE.InstancedMesh(brickGeo, brickMat, N);
    this._brickMesh.castShadow    = true;
    this._brickMesh.receiveShadow = true;

    this._studMesh = new THREE.InstancedMesh(studGeo, studMat, N);
    this._studMesh.castShadow    = true;
    this._studMesh.receiveShadow = false;

    this._colors = new Array(N);

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    // Grid is centred on the world origin
    const originX = -(COLS * CELL) / 2 + CELL / 2;
    const originZ = -(ROWS * CELL) / 2 + CELL / 2;

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const idx    = row * COLS + col;
        const plates = plateGrid[row][col];
        const hex    = colorGrid[row][col];
        const h      = plates * PLATE_H;

        const x =  originX + col * CELL;
        const z = -originZ - row * CELL; // negate so north(high row) = -Z = background = top of screen

        this._colors[idx] = hex;
        color.set(hex).convertSRGBToLinear();

        // ── Brick body ──────────────────────────────────────────────────
        dummy.position.set(x, h / 2, z);
        dummy.scale.set(1, h, 1);        // BoxGeometry height = 1, scaled to h
        dummy.updateMatrix();
        this._brickMesh.setMatrixAt(idx, dummy.matrix);
        this._brickMesh.setColorAt(idx, color);

        // ── Stud on top ─────────────────────────────────────────────────
        dummy.position.set(x, h + STUD_H / 2, z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this._studMesh.setMatrixAt(idx, dummy.matrix);
        this._studMesh.setColorAt(idx, color);
      }
    }

    this._brickMesh.instanceMatrix.needsUpdate = true;
    this._brickMesh.instanceColor.needsUpdate  = true;
    this._studMesh.instanceMatrix.needsUpdate  = true;
    this._studMesh.instanceColor.needsUpdate   = true;

    this.scene.add(this._brickMesh);
    this.scene.add(this._studMesh);

    // ── Base plate ─────────────────────────────────────────────────────────
    const baseW   = COLS * CELL + 0.6;
    const baseD   = ROWS * CELL + 0.6;
    const baseGeo = new THREE.BoxGeometry(baseW, PLATE_H * 3, baseD);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.8 });
    this._baseMesh = new THREE.Mesh(baseGeo, baseMat);
    this._baseMesh.position.set(0, -PLATE_H * 1.5, 0);
    this._baseMesh.receiveShadow = true;
    this.scene.add(this._baseMesh);

    // ── Camera position for 32×32 grid ────────────────────────────────────
    const d = COLS * CELL * 0.9;
    this._camDist = d;
    this.camera.position.set(d, d * 0.85, d);
    this.controls.target.set(0, maxH * 0.3, 0);
    this.controls.update();

    this._built = true;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  _clearScene() {
    const toDispose = [this._brickMesh, this._studMesh, this._baseMesh];
    for (const obj of toDispose) {
      if (!obj) continue;
      obj.geometry.dispose();
      obj.material.dispose();
      this.scene.remove(obj);
    }
    this._brickMesh    = null;
    this._studMesh     = null;
    this._baseMesh     = null;
    this._colors       = null;
    this._highlightIdx = null;
    if (this._outlineMesh) {
      this._outlineMesh.geometry.dispose();
      this._outlineMesh.material.dispose();
      this.scene.remove(this._outlineMesh);
      this._outlineMesh = null;
    }
  }

  // ── Colour editing ───────────────────────────────────────────────────────

  /**
   * Raycast from mouse position and return the hit instance index, or null.
   * @param {number} clientX
   * @param {number} clientY
   * @returns {number|null} instanceId (0–1023)
   */
  pickBrick(clientX, clientY) {
    if (!this._brickMesh) return null;
    const rect = this.container.getBoundingClientRect();
    const x =  ((clientX - rect.left)  / rect.width)  * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera({ x, y }, this.camera);
    // Check both brick bodies and studs; take closest hit
    const hits = this._raycaster.intersectObjects([this._brickMesh, this._studMesh]);
    if (!hits.length) return null;
    return hits[0].instanceId ?? null;
  }

  /** Apply a hex colour to a single brick + its stud. */
  setInstanceColor(instanceId, hex) {
    if (!this._brickMesh || instanceId == null) return;
    this._colors[instanceId] = hex;
    const c = new THREE.Color(hex).convertSRGBToLinear();
    this._brickMesh.setColorAt(instanceId, c);
    this._studMesh.setColorAt(instanceId, c);
    this._brickMesh.instanceColor.needsUpdate = true;
    this._studMesh.instanceColor.needsUpdate  = true;
  }

  /** Replace every instance of fromHex with toHex. */
  replaceColor(fromHex, toHex) {
    if (!this._brickMesh || !this._colors) return;
    const from = fromHex.toUpperCase();
    const to   = new THREE.Color(toHex).convertSRGBToLinear();
    for (let i = 0; i < this._colors.length; i++) {
      if ((this._colors[i] || '').toUpperCase() === from) {
        this._colors[i] = toHex;
        this._brickMesh.setColorAt(i, to);
        this._studMesh.setColorAt(i, to);
      }
    }
    this._brickMesh.instanceColor.needsUpdate = true;
    this._studMesh.instanceColor.needsUpdate  = true;
  }

  /** Show a red outline around the selected brick. Pass null to clear. */
  highlightInstance(instanceId) {
    // Remove existing outline
    if (this._outlineMesh) {
      this._outlineMesh.geometry.dispose();
      this._outlineMesh.material.dispose();
      this.scene.remove(this._outlineMesh);
      this._outlineMesh = null;
    }
    this._highlightIdx = instanceId;
    if (instanceId == null || !this._brickMesh) return;

    // Read this instance's transform to get position + height
    const mat = new THREE.Matrix4();
    this._brickMesh.getMatrixAt(instanceId, mat);
    const pos   = new THREE.Vector3();
    const scale = new THREE.Vector3();
    mat.decompose(pos, new THREE.Quaternion(), scale);

    // Outline = slightly wider box rendered from BackSide in red
    const GAP = 0.04;
    const outlineGeo = new THREE.BoxGeometry(1 - GAP + 0.1, scale.y, 1 - GAP + 0.1);
    const outlineMat = new THREE.MeshBasicMaterial({ color: 0xe3000b, side: THREE.BackSide });
    this._outlineMesh = new THREE.Mesh(outlineGeo, outlineMat);
    this._outlineMesh.position.copy(pos);
    this.scene.add(this._outlineMesh);
  }

  resetCamera() {
    if (!this._built) return;
    const d = this._camDist;
    this.camera.position.set(d, d * 0.85, d);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._clearScene();
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement.parentNode)
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
