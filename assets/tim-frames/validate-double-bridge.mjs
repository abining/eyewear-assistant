import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const specs = JSON.parse(fs.readFileSync(path.join(root, 'assets/tim-frames/catalog.json'))).models
const results = []
for (const spec of specs.filter(spec => spec.doubleBridge)) {
  const bytes = fs.readFileSync(path.join(root, 'public/models', spec.id + '-v1.glb'))
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '')
  const bridge = gltf.scene.getObjectByName('upper_bridge')
  bridge.geometry.computeBoundingBox()
  const box = bridge.geometry.boundingBox
  const center = box.getCenter(new Vector3())
  const endpointDistances = []
  for (const side of [-1, 1]) {
    const endpoint = new Vector3(side < 0 ? box.min.x : box.max.x, center.y, center.z)
    let distance = Infinity
    // Dense analytic contour independently checks the exported bridge bounds.
    for (let i = 0; i < 10000; i++) {
      const a = Math.PI * 2 * i / 10000
      const c = Math.cos(a), s = Math.sin(a)
      let x = Math.sign(c) * Math.abs(c) ** (2 / spec.exponent) * spec.width / 2000
      let y = Math.sign(s) * Math.abs(s) ** (2 / spec.exponent) * spec.height / 2000
      x *= 1 + .10 * s
      y += .003 * c
      const z = .004 - (spec.curve ?? .001) * Math.max(0, x / (spec.width / 2000)) ** 2
      const point = new Vector3(side * ((spec.width + spec.gap) / 2000 + x), (spec.cy ?? -11) / 1000 + y, z)
      distance = Math.min(distance, endpoint.distanceTo(point))
    }
    const combinedRadiusMM = spec.rim + .8
    endpointDistances.push({ side, endpointMM: endpoint.toArray().map(value => value * 1000), distanceToDenseContourMM: distance * 1000, combinedRadiusMM, visibleGapMM: Math.max(0, distance * 1000 - combinedRadiusMM) })
  }
  results.push({ id: spec.id, endpointDistances, passed: endpointDistances.every(row => row.distanceToDenseContourMM < .1 && row.visibleGapMM === 0) })
}
const report = { method: 'Actual GLTFLoader bridge bounds compared to 10,000-point analytic rim contour', results, passed: results.every(row => row.passed) }
fs.writeFileSync(path.join(root, 'assets/tim-frames/bridge-validation.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
if (!report.passed) process.exitCode = 1
