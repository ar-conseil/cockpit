// Logo AR CONSEIL en 3D (page de connexion du cockpit, et images des icônes). Ce n'est pas une vidéo : le A et le R sont
// calculés en direct. Ils se tracent une fois en chrome poli, la barre du A s'allume en verre dégradé (bleu, violet, rose :
// les couleurs de Victor), puis le logo flotte, suit la souris et accroche la lumière.
// Même principe que le logo d'Evoalys (EVOA-outils/depot-devis/outils/scene3d). Assemblé avec esbuild : voir construire.sh.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, Color, Vector3, LineCurve3, Curve,
  TubeGeometry, SphereGeometry, PlaneGeometry, BufferAttribute,
  MeshPhysicalMaterial, MeshBasicMaterial, ShaderMaterial, PointLight, DirectionalLight, PMREMGenerator,
  BackSide, DoubleSide, ACESFilmicToneMapping, SRGBColorSpace,
} from 'three';

const lisse = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const entreSort = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ---- le tracé, dans les coordonnées du fichier assets/marque/ar-conseil.svg (512 x 512), centré, y vers le haut ----
const CX = 263, CY = 258;
const p = (x, y) => new Vector3(x - CX, CY - y, 0);
class Arc extends Curve {      // boucle du R : centre (350, 204), rayon 76, du haut vers le bas par la droite
  getPoint(t, c = new Vector3()) { const a = -Math.PI / 2 + Math.PI * t; return c.copy(p(350 + 76 * Math.cos(a), 204 + 76 * Math.sin(a))); }
}
const SEGMENTS = [
  new LineCurve3(p(116, 388), p(208, 128)), new LineCurve3(p(208, 128), p(300, 388)),   // le A
  new LineCurve3(p(300, 388), p(300, 128)), new LineCurve3(p(300, 128), p(350, 128)),   // le fût du R, puis le haut de la boucle
  new Arc(), new LineCurve3(p(350, 280), p(300, 280)), new LineCurve3(p(342, 280), p(410, 388)),
];
const BARRE = new LineCurve3(p(168, 280), p(300, 280));   // barre du A : verre lumineux
const LONGUEURS = SEGMENTS.map(s => s.getLength()), TOTAL = LONGUEURS.reduce((a, b) => a + b, 0);
const R = 18;   // rayon du tube (trait de 36 dans le SVG)

// toile : <canvas>. options.cadre(l, h) → { x, y, d } : centre et largeur du logo en pixels. options.fixe : une seule image.
function decor(toile, options) {
  options = options || {};
  const renderer = new WebGLRenderer({ canvas: toile, antialias: true, alpha: true, preserveDrawingBuffer: !!options.fixe });
  let ratio = options.ratio || Math.min(window.devicePixelRatio || 1, 2);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  const camera = new PerspectiveCamera(22, 1, 10, 8000);
  camera.position.set(0, 0, 1600);

  // ---- éclairage de studio : panneaux lumineux reflétés dans le chrome ----
  {
    const studio = new Scene();
    studio.add(new Mesh(new SphereGeometry(60, 32, 16), new MeshBasicMaterial({ color: new Color(0x4a5274), side: BackSide })));
    const panneau = (couleur, force, l, h, x, y, z) => {
      const m = new Mesh(new PlaneGeometry(l, h), new MeshBasicMaterial({ color: new Color(couleur).multiplyScalar(force), side: DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); studio.add(m);
    };
    panneau(0xffffff, 14, 40, 12, 0, 34, 12);
    panneau(0x8fb4ff, 8, 12, 34, -38, 4, 14);
    panneau(0xd8c8ff, 6, 6, 30, 38, 0, 18);
    panneau(0x7a5cf0, 5, 44, 8, 0, -28, 24);
    panneau(0xffe6ea, 9, 12, 9, 14, 12, 42);
    panneau(0x9fb8ff, 4, 20, 20, -10, 6, -44);
    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(studio, 0.035).texture;
    pmrem.dispose();
  }
  const cle = new DirectionalLight(0xffffff, 1.3); cle.position.set(-.35, .7, 1); scene.add(cle);
  const contre = new DirectionalLight(0x9a7bff, 1.1); contre.position.set(.8, .3, -1); scene.add(contre);
  const balayage = new PointLight(0xffffff, 0, 1400, 1.5); scene.add(balayage);
  const lampeTete = new PointLight(0xc9b8ff, 0, 700, 1.6); scene.add(lampeTete);

  // ---- les lettres : chrome poli ----
  const chrome = new MeshPhysicalMaterial({ color: 0xf4f6ff, metalness: 1, roughness: .1, envMapIntensity: 1.7, clearcoat: .6, clearcoatRoughness: .15 });
  const pivot = new Group(); scene.add(pivot);
  const flotte = new Group(); pivot.add(flotte);
  const logo = new Group(); logo.scale.z = .85; flotte.add(logo);
  const TRONCONS = 90, COTES = 28;
  const tubes = SEGMENTS.map((s, i) => {
    const m = new Mesh(new TubeGeometry(s, s instanceof Arc ? 120 : TRONCONS, R, COTES, false), chrome);
    m.userData.debut = LONGUEURS.slice(0, i).reduce((a, b) => a + b, 0) / TOTAL; m.userData.part = LONGUEURS[i] / TOTAL;
    m.userData.troncons = s instanceof Arc ? 120 : TRONCONS; logo.add(m); return m;
  });
  const geoBoule = new SphereGeometry(R, 32, 20);
  const joints = [];   // bouts arrondis et jointures, montrés quand le tracé les atteint
  SEGMENTS.forEach((s, i) => [0, 1].forEach(k => {
    const b = new Mesh(geoBoule, chrome); b.position.copy(s.getPoint(k));
    b.userData.u = tubes[i].userData.debut + k * tubes[i].userData.part; logo.add(b); joints.push(b);
  }));
  const tete = new Mesh(geoBoule, chrome); logo.add(tete);

  // ---- la barre du A : verre teinté, lumineux, dégradé bleu → violet → rose ----
  const geoBarre = new TubeGeometry(BARRE, 60, R * .98, COTES, false);
  {
    const pos = geoBarre.attributes.position, couleurs = new Float32Array(pos.count * 3), x0 = BARRE.v1.x, x1 = BARRE.v2.x;
    const c = new Color(), bleu = new Color(0x4f8cff), violet = new Color(0x9a7bff), rose = new Color(0xff8f9c);
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.max(0, (pos.getX(i) - x0) / (x1 - x0)));
      if (t < .55) c.copy(bleu).lerp(violet, t / .55); else c.copy(violet).lerp(rose, (t - .55) / .45);
      couleurs.set([c.r, c.g, c.b], i * 3);
    }
    geoBarre.setAttribute('color', new BufferAttribute(couleurs, 3));
  }
  const verre = new MeshPhysicalMaterial({ vertexColors: true, metalness: .15, roughness: .08, clearcoat: 1, clearcoatRoughness: .05,
    envMapIntensity: 1.1, iridescence: .35, transparent: true, opacity: 1 });
  verre.onBeforeCompile = (s) => {   // la barre éclaire de l'intérieur
    s.uniforms.uLueur = verre.userData.lueur = { value: 0 };
    s.fragmentShader = 'uniform float uLueur;\n' + s.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n totalEmissiveRadiance += vColor.rgb * uLueur;');
  };
  const AVANT = R * .7;   // la barre passe devant les jambes du A
  const barre = new Mesh(geoBarre, verre); barre.position.z = AVANT; logo.add(barre);
  // bouts arrondis de la barre, de la couleur de chaque extrémité (une sphère n'a pas de dégradé)
  const boutsBarre = [[BARRE.v1, 0x4f8cff], [BARRE.v2, 0xff8f9c]].map(([v, c]) => {
    const g = geoBoule.clone(), n = g.attributes.position.count, col = new Float32Array(n * 3), cc = new Color(c);
    for (let i = 0; i < n; i++) col.set([cc.r, cc.g, cc.b], i * 3);
    g.setAttribute('color', new BufferAttribute(col, 3));
    const m = new Mesh(g, verre); m.position.copy(v); m.position.z = AVANT; logo.add(m); return m;
  });

  // ---- halo violet derrière le logo ----
  const halo = new Mesh(new PlaneGeometry(900, 900), new ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uForce: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `varying vec2 vUv; uniform float uForce;
      void main(){ float d = length(vUv - .5) * 2.; float a = exp(-d * d * 3.2) * .5 * uForce;
        gl_FragColor = vec4(vec3(.48, .38, 1.) * a, a); }`,
  }));
  halo.position.z = -160; flotte.add(halo);

  // ---- cadrage ----
  let l = 0, h = 0, echelle = 1;
  const LARGEUR = 410 - 116 + 2 * R;
  function taille() {
    l = Math.max(2, toile.clientWidth); h = Math.max(2, toile.clientHeight);
    renderer.setPixelRatio(ratio); renderer.setSize(l, h, false);
    camera.aspect = l / h; camera.updateProjectionMatrix();
    const unites = 2 * camera.position.z * Math.tan(camera.fov * Math.PI / 360) / h;
    const c = options.cadre ? options.cadre(l, h) : { x: l / 2, y: h / 2, d: Math.min(l, h) * .62 };
    echelle = c.d * unites / LARGEUR;
    pivot.position.set((c.x - l / 2) * unites, (h / 2 - c.y) * unites, 0);
    pivot.scale.setScalar(echelle);
  }

  let visX = 0, visY = 0, rotX = 0, rotY = 0;
  if (!options.fixe) window.addEventListener('pointermove', (e) => {
    visY = (e.clientX / window.innerWidth - .5) * .6; visX = (e.clientY / window.innerHeight - .5) * .4;
  }, { passive: true });

  const pt = new Vector3(), monde = new Vector3();
  function image(t, dt) {
    const avance = entreSort(Math.min(1, Math.max(0, (t - .2) / 2.2)));    // le tracé des lettres, en un peu plus de 2 secondes
    let teteVue = false;
    tubes.forEach((m, i) => {
      const k = Math.min(1, Math.max(0, (avance - m.userData.debut) / m.userData.part));
      m.visible = k > 0; m.geometry.setDrawRange(0, Math.floor(k * m.userData.troncons) * COTES * 6);
      if (k > 0 && k < 1) { SEGMENTS[i].getPoint(k, pt); teteVue = true; }
    });
    joints.forEach(b => { b.visible = avance > 0 && avance >= b.userData.u - 1e-4; });
    tete.visible = teteVue; if (teteVue) tete.position.copy(pt);
    monde.copy(pt); monde.z = 60; logo.localToWorld(monde); lampeTete.position.copy(monde);
    lampeTete.intensity = teteVue ? 2200 * echelle * echelle : 0;

    const allume = lisse(2.2, 3.0, t);                                       // la barre s'allume quand le R est fini
    barre.visible = allume > 0; boutsBarre.forEach(b => { b.visible = allume > 0; });
    barre.scale.x = 1; verre.opacity = allume;
    if (verre.userData.lueur) verre.userData.lueur.value = .35 + .9 * Math.exp(-Math.pow((t - 2.9) / .35, 2)) * (options.fixe ? 0 : 1);

    const vie = lisse(2.4, 3.8, t);
    flotte.position.y = Math.sin(t * .8) * 8 * vie;
    flotte.rotation.y = Math.sin(t * .35) * .2 * vie;
    flotte.rotation.x = Math.sin(t * .27 + 1) * .07 * vie;
    const k = 1 - Math.pow(.0025, Math.min(dt, .1));
    rotX += (visX * vie - rotX) * k; rotY += (visY * vie - rotY) * k;
    pivot.rotation.set(rotX - .05, rotY - .14, 0);
    const cycle = ((t - 3.4) % 7 + 7) % 7, b = lisse(0, 1.6, cycle);
    balayage.position.set(pivot.position.x + (-420 + 840 * b) * echelle, pivot.position.y + 160 * echelle, 380 * echelle);
    balayage.intensity = !options.fixe && t > 3.4 ? 9000 * echelle * echelle * Math.sin(Math.PI * b) : 0;
    if (scene.environmentRotation) scene.environmentRotation.y = .4 + t * .06;
    halo.material.uniforms.uForce.value = lisse(.2, 2.6, t);
    renderer.render(scene, camera);
  }

  taille();
  if (options.fixe) { image(30, .016); return { arreter() { renderer.dispose(); } }; }

  let depart = 0, avant = 0, arrete = false;
  const ro = window.ResizeObserver ? new ResizeObserver(taille) : null;
  if (ro) ro.observe(toile); else window.addEventListener('resize', taille);
  function boucle(maintenant) {
    if (arrete) return;
    if (!depart) { depart = maintenant; avant = maintenant; }
    const dt = (maintenant - avant) / 1000; avant = maintenant;
    image((maintenant - depart) / 1000, dt);
    requestAnimationFrame(boucle);
  }
  requestAnimationFrame(boucle);
  return { arreter() { arrete = true; if (ro) ro.disconnect(); renderer.dispose(); } };
}

window.ARConseil3D = { decor };
