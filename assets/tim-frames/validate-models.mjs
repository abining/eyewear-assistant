import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Box3, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const directory = path.join(root, 'public/models')
const catalog = JSON.parse(fs.readFileSync(path.join(directory, 'models.json'))).models
const input = JSON.parse(fs.readFileSync(path.join(root, 'assets/tim-frames/catalog.json'))).models
const results = []
const failures = []
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
for (const item of catalog) {
  const buffer = fs.readFileSync(path.join(directory, item.file))
  const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '')
  const meshes = []
  gltf.scene.traverse((object) => { if (object.isMesh) meshes.push(object) })
  const front = new Box3()
  gltf.scene.updateMatrixWorld(true)
  const temples = meshes.filter(mesh => /^temple_(left|right)$/.test(mesh.name))
  const lenses = meshes.filter(mesh => mesh.name.startsWith('lens'))
  for (const object of meshes) if (!temples.includes(object)) front.expandByObject(object, true)
  const size = front.getSize(new Vector3()).multiplyScalar(1000).toArray()
  const triangles = meshes.reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3, 0)
  const checks = { under25MiB: buffer.length < 25 * 1024 * 1024, namedTemples: temples.length === 2, namedLenses: lenses.length >= 1, widthReasonable: size[0] >= 120 && size[0] <= 165, finiteDimensions: size.every(Number.isFinite), previewExists: fs.existsSync(path.join(directory, item.preview)) }
  if (item.collection === 'tim-video') {
    checks.hingeOrigins = temples.every(mesh => Math.abs(mesh.position.x) > .05 && Math.abs(mesh.position.x) < .085 && Math.abs(mesh.rotation.x) < .00001 && Math.abs(mesh.rotation.y) < .00001 && Math.abs(mesh.rotation.z) < .00001)
    checks.rearwardTemples = temples.every(mesh => { mesh.geometry.computeBoundingBox(); return mesh.geometry.boundingBox.min.z < -.12 && mesh.geometry.boundingBox.max.z < .003 })
    checks.lensesBelowBridge = lenses.every(mesh => { mesh.geometry.computeBoundingBox(); return mesh.geometry.boundingBox.getCenter(new Vector3()).y < 0 })
    const spec = input.find(spec => spec.id === item.id)
    checks.tintPreserved = !spec.lens || spec.lens === 'clear' || lenses.every(mesh => mesh.userData.preserveLensMaterial === true)
    checks.editableSource = fs.existsSync(path.join(root, 'assets/tim-frames', item.id + '.blend'))
  }
  for (const [check, passed] of Object.entries(checks)) if (!passed) failures.push({ id: item.id, check })
  results.push({ id: item.id, bytes: buffer.length, sha256: sha(buffer), widthHeightDepthMM: size, meshCount: meshes.length, triangles, lenses: lenses.length, checks })
}
const report = { method: 'Actual Three.js GLTFLoader parse + geometry contract inspection, not type checking', models: results, failures, passed: failures.length === 0 }
fs.writeFileSync(path.join(root, 'assets/tim-frames/validation.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ models: results.length, newModels: results.filter(row => row.id.startsWith('tim-')).length, bytes: results.reduce((sum, row) => sum + row.bytes, 0), maxBytes: Math.max(...results.map(row => row.bytes)), failures }, null, 2))
if (failures.length) process.exitCode = 1
