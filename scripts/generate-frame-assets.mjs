/**
 * Original demonstration eyewear assets drawn with Three.js geometry for this project.
 * No commercial frame, third-party mesh, reference-video asset, or product design is copied.
 * Units: metres; Y up; front is +Z; the bridge is centred at the origin.
 * Run with: node scripts/generate-frame-assets.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  CatmullRomCurve3,
  Group,
  Mesh,
  MeshStandardMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'

// GLTFExporter uses FileReader for the binary chunks. Node 22 supplies Blob,
// but not FileReader; no image or canvas API is needed for these plain meshes.
if (!globalThis.FileReader) {
  globalThis.FileReader = class {
    result = null
    onloadend = null
    async readAsArrayBuffer(blob) {
      this.result = await blob.arrayBuffer()
      this.onloadend?.()
    }
  }
}

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/models')
const V = (x, y, z) => new Vector3(x, y, z)
const materials = {
  gold: new MeshStandardMaterial({ name: 'warm brushed gold', color: 0xc5944e, metalness: 0.92, roughness: 0.23 }),
  black: new MeshStandardMaterial({ name: 'satin black acetate', color: 0x171a1e, metalness: 0.03, roughness: 0.27 }),
  clear: new MeshStandardMaterial({ name: 'clear champagne acetate', color: 0xe8d9bd, metalness: 0.0, roughness: 0.14, transparent: true, opacity: 0.56 }),
  brown: new MeshStandardMaterial({ name: 'warm tortoise brown acetate', color: 0x71442e, metalness: 0.02, roughness: 0.24 }),
  lens: new MeshStandardMaterial({ name: 'subtle clear demonstration lens', color: 0xdbe7eb, metalness: 0, roughness: 0.06, transparent: true, opacity: 0.075, depthWrite: false }),
  pad: new MeshStandardMaterial({ name: 'silicone nose pad', color: 0xf1e8d5, metalness: 0, roughness: 0.32, transparent: true, opacity: 0.64 }),
  accent: new MeshStandardMaterial({ name: 'small gold accent', color: 0xd1a968, metalness: 0.82, roughness: 0.22 }),
}

function tube(points, radius, material, closed = false) {
  const curve = new CatmullRomCurve3(points, closed, 'centripetal')
  return new Mesh(new TubeGeometry(curve, closed ? Math.max(64, points.length * 2) : Math.max(16, points.length * 8), radius, 8, closed), material)
}

function rimPoints(shape, side, centerX, centerY, width, height, z) {
  if (shape === 'cat-eye') {
    // The upswept outer upper corner gives this design its own silhouette.
    const s = new Shape()
    const w = width / 2
    const h = height / 2
    s.moveTo(-w, -h * 0.12)
    s.bezierCurveTo(-w * 1.06, h * 0.65, -w * 0.35, h * 0.85, w * 0.22, h * 0.55)
    s.bezierCurveTo(w * 0.60, h * 0.52, w * 0.88, h * 0.92, w * 1.12, h * 1.10)
    s.bezierCurveTo(w * 1.10, h * 0.28, w * 1.06, -h * 0.48, w * 0.73, -h * 0.76)
    s.bezierCurveTo(w * 0.22, -h * 1.13, -w * 0.42, -h * 1.03, -w * 0.84, -h * 0.65)
    s.bezierCurveTo(-w * 1.03, -h * 0.46, -w, -h * 0.28, -w, -h * 0.12)
    return s.getPoints(12).slice(0, -1).map(p => V(centerX + side * p.x, centerY + p.y, z))
  }
  const n = 80
  const exponent = shape === 'rectangle' ? 4.4 : 2
  const points = []
  for (let i = 0; i < n; i++) {
    const a = 2 * Math.PI * i / n
    const c = Math.cos(a)
    const s = Math.sin(a)
    const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / exponent) * width / 2
    const y = Math.sign(s) * Math.pow(Math.abs(s), 2 / exponent) * height / 2
    points.push(V(centerX + side * x, centerY + y, z))
  }
  return points
}

function lensSurface(outline, side, name) {
  const points = outline.map(p => new Vector2(p.x, p.y))
  if (side < 0) points.reverse()
  const shape = new Shape(points)
  const mesh = new Mesh(new ShapeGeometry(shape), materials.lens)
  mesh.name = name
  mesh.position.z = outline[0].z - 0.0011
  return mesh
}

function temple(side, x, y, mat, thickness, length) {
  // Geometry is local to the hinge: renderer pivots this exact mesh in Y.
  const points = [
    V(0, 0, 0),
    V(side * 0.005, -0.001, -0.022),
    V(side * 0.010, -0.003, -0.061),
    V(side * 0.012, -0.004, -0.102),
    V(side * 0.010, -0.012, -length),
  ]
  const mesh = tube(points, thickness, mat)
  mesh.name = side > 0 ? 'temple_left' : 'temple_right'
  mesh.position.set(x, y, -0.003)
  return mesh
}

function makeFrame(spec) {
  const root = new Group()
  root.name = spec.id
  const w = spec.lens_width / 1000
  const bridge = spec.bridge_width / 1000
  const height = spec.height / 1000
  const cy = spec.centerY / 1000
  const z = 0.004
  const mat = materials[spec.palette]
  const cx = bridge / 2 + w / 2
  const frontOuter = cx + w / 2 + (spec.shape === 'cat-eye' ? w * 0.06 : 0)

  for (const side of [1, -1]) {
    const outline = rimPoints(spec.shape, side, side * cx, cy, w, height, z)
    const rim = tube(outline, spec.rim / 1000, mat, true)
    rim.name = side > 0 ? 'rim_left' : 'rim_right'
    root.add(rim)
    root.add(lensSurface(outline, side, side > 0 ? 'lens_left' : 'lens_right'))

    const outerX = side * (frontOuter + 0.0078)
    const hingeY = spec.shape === 'cat-eye' ? cy + height * 0.36 : cy + height * 0.18
    const end = outline.reduce((best, p) => side * p.x > side * best.x ? p : best)
    const connector = tube([end, V(side * (frontOuter + 0.004), hingeY, z), V(outerX, hingeY, 0.001)], spec.rim / 1000 * 0.8, mat)
    connector.name = side > 0 ? 'endpiece_left' : 'endpiece_right'
    root.add(connector)
    root.add(temple(side, outerX, hingeY, mat, spec.templeRadius / 1000, spec.temple_length / 1000))

    if (spec.palette === 'black' || spec.palette === 'brown') {
      const badge = new Mesh(new SphereGeometry(0.00125, 12, 8), materials.accent)
      badge.name = side > 0 ? 'hinge_stud_left' : 'hinge_stud_right'
      badge.position.set(outerX - side * 0.0018, hingeY, z + 0.0015)
      root.add(badge)
    }
  }

  const inner = bridge / 2 + 0.001
  const archY = cy + height * 0.12
  const bridgeMesh = tube([
    V(-inner, archY, z),
    V(-bridge * 0.30, archY + 0.006, z + 0.0006),
    V(0, archY + 0.008, z + 0.0008),
    V(bridge * 0.30, archY + 0.006, z + 0.0006),
    V(inner, archY, z),
  ], spec.rim / 1000 * (spec.palette === 'gold' ? 0.78 : 1.1), mat)
  bridgeMesh.name = 'bridge'
  root.add(bridgeMesh)

  if (spec.palette === 'gold') {
    for (const side of [1, -1]) {
      const pad = new Mesh(new SphereGeometry(0.003, 12, 8), materials.pad)
      pad.scale.set(0.48, 1, 0.48)
      pad.position.set(side * (bridge / 2 + 0.002), cy - 0.006, -0.0006)
      pad.name = side > 0 ? 'nose_pad_left' : 'nose_pad_right'
      root.add(pad)
    }
  }

  if (spec.palette === 'brown') {
    // A tiny raised brow line reinforces the upswept cat-eye without a logo.
    for (const side of [1, -1]) {
      const arc = rimPoints(spec.shape, side, side * cx, cy, w, height, z + 0.0011)
      const top = arc.filter(p => p.y > cy + height * 0.25).sort((a, b) => a.x - b.x)
      const brow = tube(top, 0.00065, materials.accent)
      brow.name = side > 0 ? 'brow_detail_left' : 'brow_detail_right'
      root.add(brow)
    }
  }
  return root
}

const models = [
  { id: 'aurora-round', label: '晨光细金圆框', file: 'aurora-round.glb', color: '香槟金', material: '细金属', lens_width: 49, bridge_width: 20, temple_length: 138, shape: 'round', styles: ['minimal', 'classic'], palette: 'gold', height: 45, centerY: -12, rim: 0.9, templeRadius: 1.05 },
  { id: 'noir-rectangle', label: '墨线经典方框', file: 'noir-rectangle.glb', color: '哑光黑', material: '醋酸纤维质感', lens_width: 53, bridge_width: 18, temple_length: 142, shape: 'rectangle', styles: ['classic', 'bold'], palette: 'black', height: 39, centerY: -13, rim: 2.45, templeRadius: 2.2 },
  { id: 'mist-clear', label: '雾光透明轻框', file: 'mist-clear.glb', color: '透明香槟', material: '透明醋酸纤维质感', lens_width: 51, bridge_width: 19, temple_length: 140, shape: 'round', styles: ['minimal', 'creative'], palette: 'clear', height: 42, centerY: -12, rim: 2.3, templeRadius: 1.85 },
  { id: 'cocoa-cat-eye', label: '可可上扬猫眼', file: 'cocoa-cat-eye.glb', color: '暖棕', material: '醋酸纤维质感', lens_width: 52, bridge_width: 18, temple_length: 140, shape: 'cat-eye', styles: ['bold', 'creative'], palette: 'brown', height: 43, centerY: -13, rim: 2.15, templeRadius: 2.0 },
]

await mkdir(outDir, { recursive: true })
const exporter = new GLTFExporter()
for (const spec of models) {
  const scene = makeFrame(spec)
  const glb = await exporter.parseAsync(scene, { binary: true, onlyVisible: true, copyright: 'Original eyewear demonstration geometry for this project; not a retail product.' })
  await writeFile(path.join(outDir, spec.file), Buffer.from(glb))
  console.log(`${spec.file}: ${glb.byteLength} bytes`)
}
await writeFile(path.join(outDir, 'models.json'), JSON.stringify({ models: models.map(({ height, centerY, rim, templeRadius, ...listed }) => listed) }, null, 2) + '\n')
console.log(`models.json: ${models.length} original examples`)
