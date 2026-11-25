// Root's repair audit: intersect the actual exported triangle surfaces.
// Does not reuse parametric outline code or metadata attachment coordinates.
import fs from 'node:fs'
import { Vector3, Triangle, Ray, Box3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
const specs = JSON.parse(fs.readFileSync('assets/tim-frames/catalog.json')).models
const triangles = (mesh) => {
  const pos = mesh.geometry.attributes.position, ix = mesh.geometry.index
  const result = []
  for (let i = 0; i < (ix?.count ?? pos.count); i += 3) {
    const pts = [0, 1, 2].map(j => new Vector3().fromBufferAttribute(pos, ix ? ix.getX(i+j) : i+j).applyMatrix4(mesh.matrixWorld))
    result.push({ tri: new Triangle(...pts), box: new Box3().setFromPoints(pts), pts })
  }
  return result
}
const ray = new Ray(), delta = new Vector3(), hit = new Vector3()
const edgeHits = (points, tri) => {
  for (let i = 0; i < 3; i++) {
    const a = points[i], b = points[(i+1)%3]
    const length = delta.subVectors(b,a).length()
    if (length < 1e-12) continue
    ray.set(a, delta.multiplyScalar(1/length))
    if (ray.intersectTriangle(tri.a,tri.b,tri.c,false,hit) && a.distanceTo(hit) <= length+1e-9) return true
  }
  return false
}
const rows = []
for (const spec of specs.filter(s => s.design !== 'shield')) {
  const bytes = fs.readFileSync(`public/models/${spec.id}-v1.glb`)
  const { scene } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'')
  scene.updateMatrixWorld(true)
  for (const name of ['bridge', ...(spec.doubleBridge ? ['upper_bridge'] : [])]) {
    const bridge = scene.getObjectByName(name)
    if (!bridge) throw new Error(`${spec.id} missing ${name}`)
    const bt = triangles(bridge)
    for (const side of ['left','right']) {
      const rim = scene.getObjectByName(`rim_${side}`) ?? scene.getObjectByName(`polished_glass_edge_${side}`)
      if (!rim) throw new Error(`${spec.id} missing rim ${side}`)
      const rt = triangles(rim)
      let contact = false
      outer: for (const a of bt) for (const b of rt) {
        if (!a.box.intersectsBox(b.box)) continue
        if (edgeHits(a.pts,b.tri) || edgeHits(b.pts,a.tri)) { contact = true; break outer }
      }
      rows.push({ id:spec.id, bridge:name, side, triangleSurfaceIntersection:contact })
    }
  }
}
const report = { method:'Actual exported world-space triangle surfaces; AABB broad phase and finite edge/triangle intersection, not distance threshold or generator metadata', checkedConnections:rows.length, failures:rows.filter(r=>!r.triangleSurfaceIntersection), rows }
fs.writeFileSync('assets/tim-frames/bridge-intersections.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({checkedConnections:rows.length,failures:report.failures},null,2))
if (report.failures.length) process.exitCode=1
