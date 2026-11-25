"""Locally authored approximate eyewear: Blender -> editable .blend + GLB + PNG.

Usage: Blender --background --python scripts/generate-tim-frames.py -- [--only ID]
Input is assets/tim-frames/catalog.json. No photo textures, logos, or paid APIs.
Design coordinates are metres, Y up, front +Z, bridge origin. Blender coordinates
are converted explicitly; glTF export restores the intended Y-up convention.
"""
import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets/tim-frames'
PUBLIC = ROOT / 'public/models'
SOURCE = 'https://www.douyin.com/video/7711668743713066255'


def xyz(p):
    return (p[0], -p[2], p[1])


def material(name, color, metallic=0, roughness=.25, alpha=1):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, alpha)
    mat.use_nodes = True
    p = mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Alpha'].default_value = alpha
    p.inputs['Coat Weight'].default_value = .16
    p.inputs['Coat Roughness'].default_value = .12
    if alpha < 1:
        mat.surface_render_method = 'DITHERED'
    return mat


def mesh(name, vertices, faces, mat, origin=(0, 0, 0)):
    data = bpy.data.meshes.new(name)
    data.from_pydata([xyz(v) for v in vertices], [], faces)
    data.materials.append(mat)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = xyz(origin)
    for p in data.polygons:
        p.use_smooth = True
    return obj


def sweep(name, points, radius, mat, closed=False, depth=None, origin=(0, 0, 0), segments=8):
    vertices, faces = [], []
    depth = depth or radius
    for i, p in enumerate(points):
        prev = Vector(points[(i - 1) % len(points)] if closed or i else points[0])
        nxt = Vector(points[(i + 1) % len(points)] if closed or i < len(points) - 1 else points[-1])
        tangent = (nxt - prev).normalized()
        ref = Vector((0, 0, 1)) if abs(tangent.z) < .9 else Vector((0, 1, 0))
        normal = tangent.cross(ref).normalized()
        binormal = tangent.cross(normal).normalized()
        for j in range(segments):
            a = 2 * math.pi * j / segments
            q = Vector(p) + normal * (math.cos(a) * radius) + binormal * (math.sin(a) * depth)
            vertices.append(tuple(q))
    for i in range(len(points) if closed else len(points) - 1):
        for j in range(segments):
            a, b = i * segments + j, i * segments + (j + 1) % segments
            c, d = ((i + 1) % len(points)) * segments + (j + 1) % segments, ((i + 1) % len(points)) * segments + j
            faces.append((a, b, c, d))
    if not closed:
        faces.append(tuple(reversed(range(segments))))
        faces.append(tuple((len(points) - 1) * segments + j for j in range(segments)))
    return mesh(name, vertices, faces, mat, origin)


def bezier(points, steps=32):
    result = []
    for k in range(steps):
        t = k / (steps - 1)
        u = 1 - t
        result.append(tuple(u**3 * points[0][j] + 3*u*u*t*points[1][j] + 3*u*t*t*points[2][j] + t**3*points[3][j] for j in range(3)))
    return result


def outline(spec, side, count=80):
    width, height, gap = (spec[k] / 1000 for k in ('width', 'height', 'gap'))
    cy, cx = spec.get('cy', -11) / 1000, (width + gap) / 2
    exponent = spec.get('exponent', 2)
    pts = []
    for i in range(count):
        a = 2*math.pi*i/count
        c, s = math.cos(a), math.sin(a)
        x = math.copysign(abs(c)**(2/exponent), c) * width/2
        y = math.copysign(abs(s)**(2/exponent), s) * height/2
        x *= 1 + spec.get('taper', 0) * s
        y += spec.get('browSlope', 0) * c
        if spec.get('design') == 'aviator':
            x *= 1 + .10*s
            y += .003 * c
        if spec.get('design') == 'cat':
            y += .004 * max(c, 0)**2
        if spec.get('design') == 'browline':
            y += .0015 * c
        z = .004 - spec.get('curve', .001) * (max(0, x / (width/2))**2)
        pts.append((side * (cx + x), cy + y, z))
    return pts


def lens(name, pts, mat, preserve=False):
    cx, cy = sum(p[0] for p in pts)/len(pts), sum(p[1] for p in pts)/len(pts)
    vertices = [(cx, cy, .0035)] + [(x, y, z-.0008) for x,y,z in pts]
    faces = [(0, i+1, (i+1) % len(pts) + 1) for i in range(len(pts))]
    obj = mesh(name, vertices, faces, mat)
    obj['preserveLensMaterial'] = preserve
    # Both sides are intentionally visible at oblique reference-head angles.
    mat.use_backface_culling = False
    return obj


def inner_rim_at_height(spec, side, height):
    """Intersect the actual sampled rim centerline with a horizontal plane."""
    points = outline(spec, side)
    crossings = []
    for i, a in enumerate(points):
        b = points[(i + 1) % len(points)]
        if min(a[1], b[1]) <= height <= max(a[1], b[1]) and abs(b[1] - a[1]) > 1e-10:
            t = (height - a[1]) / (b[1] - a[1])
            crossings.append(tuple(a[j] + t * (b[j] - a[j]) for j in range(3)))
    if not crossings:
        raise ValueError(f"Upper bridge height {height} does not intersect {spec['id']} rim")
    return min(crossings, key=lambda point: abs(point[0]))


def sphere(name, pos, scale, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, location=xyz(pos))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (scale[0], scale[2], scale[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def build(spec):
    frame = material('Frame | ' + spec['color'], spec['rgb'], spec.get('metal', .03), spec.get('rough', .22), spec.get('alpha', 1))
    silver = material('Brushed hinge metal', (.54,.57,.61), .85, .25)
    rubber = material('Soft temple tip', (.025,.028,.032), .02, .44)
    pad = material('Translucent silicone', (.81,.84,.85), 0, .25, .58)
    lens_type = spec.get('lens', 'clear')
    if lens_type == 'silver':
        glass = material('Silver mirrored shield', (.66,.72,.78), .98, .115)
    elif lens_type == 'fire':
        glass = material('Rose gold interference shield', (.80,.02,.15), .87, .13)
    elif lens_type == 'violet':
        glass = material('Lavender blue optical shield', (.20,.16,.72), .50, .13, .72)
    elif lens_type == 'dark':
        glass = material('Smoke solar lens', (.014,.022,.031), .32, .17, .96)
    elif lens_type == 'wine':
        glass = material('Wine solar lens', (.17,.028,.045), .12, .2, .91)
    else:
        glass = material('Clear optical lens', (.80,.89,.96), 0, .08, .075)
    thickness = spec['rim'] / 1000
    width, gap, height = spec['width']/1000, spec['gap']/1000, spec['height']/1000
    cy = spec.get('cy', -11)/1000
    outer = width + gap/2
    hinge_y = cy + height * spec.get('hingeRatio', .26)
    shield = spec.get('design') == 'shield'
    if shield:
        # Broad swept single lens with an actual lower nasal notch.
        w = spec.get('frontWidth', 146)/2000
        columns, rows = 64, 8
        vertices, faces, top_edge, bottom_edge = [], [], [], []
        for i in range(columns + 1):
            u = -1 + 2*i/columns
            x, z = w*u, .009-.024*u*u
            top = .012+.005*(1-u*u)
            nasal = max(0, 1-abs(x)/.014)
            nasal = nasal*nasal*(3-2*nasal)
            bottom = -.038+.010*abs(u)**4+.026*nasal
            top_edge.append((x,top,z))
            bottom_edge.append((x,bottom,z))
            for j in range(rows + 1):
                vertices.append((x,bottom+(top-bottom)*j/rows,z))
        for i in range(columns):
            for j in range(rows):
                a = i*(rows+1)+j
                faces.append((a,a+rows+1,a+rows+2,a+1))
        obj = mesh('lens_shield', vertices, faces, glass)
        obj['preserveLensMaterial'] = True
        if lens_type == 'fire':
            # One material / one mesh retains lens extras in Three.js. Smooth
            # vertex colors convey a coating gradient without image textures.
            colors = obj.data.color_attributes.new(name='Coating',type='FLOAT_COLOR',domain='CORNER')
            for face in obj.data.polygons:
                for loop_index in face.loop_indices:
                    x = vertices[obj.data.loops[loop_index].vertex_index][0]
                    t = (x/w+1)/2
                    stops = [(1,.36,.018),(.82,.016,.10),(.56,.012,.42)]
                    band = min(1,int(t*2))
                    f = t*2-band
                    colors.data[loop_index].color = tuple(stops[band][k]*(1-f)+stops[band+1][k]*f for k in range(3))+(1,)
            shader = glass.node_tree.nodes.new('ShaderNodeVertexColor')
            shader.layer_name = 'Coating'
            glass.node_tree.links.new(shader.outputs['Color'],glass.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
        sweep('shield_upper_rail', top_edge, thickness, frame, depth=thickness*.8)
        if spec.get('fullRim'):
            sweep('shield_contour', top_edge+list(reversed(bottom_edge)), thickness*.72, frame, True)
        outer, hinge_y = w, .008
    else:
        for side, suffix in [(1,'left'),(-1,'right')]:
            pts = outline(spec, side)
            lens('lens_'+suffix, pts, glass, lens_type != 'clear')
            if spec.get('design') == 'rimless':
                edge = material('Polished clear lens edge', (.35,.45,.52), .05, .14, .45)
                sweep('polished_glass_edge_'+suffix, pts, .00024, edge, True)
            if spec.get('design') != 'rimless':
                sweep('rim_'+suffix, pts, thickness, silver if spec.get('design') == 'browline' else frame, True, depth=spec.get('depth', spec['rim']*.92)/1000)
            if spec.get('design') == 'browline':
                upper = [p for p in pts if p[1] >= cy+.005]
                sweep('raised_brow_'+suffix, upper, spec.get('browRim', 2)/1000, frame)
        bridge_y = cy + height * .22
        lower_ends = [inner_rim_at_height(spec, side, bridge_y) for side in (-1, 1)]
        bridge = bezier([lower_ends[0],(-gap*.3,.004,.006),(gap*.3,.004,.006),lower_ends[1]],20)
        bridge_mesh = sweep('bridge', bridge, max(.0007,thickness*.78), frame)
        bridge_mesh['attachmentLeft'] = list(lower_ends[0])
        bridge_mesh['attachmentRight'] = list(lower_ends[1])
        if spec.get('doubleBridge'):
            bridge_height = cy + height * .43
            endpoints = [inner_rim_at_height(spec, side, bridge_height) for side in (-1, 1)]
            sweep('upper_bridge', endpoints, .0008, frame)
    for side, suffix in [(1,'left'),(-1,'right')]:
        hinge = (side*(outer+.005),hinge_y,-.002 if not shield else -.015)
        sweep('endpiece_'+suffix, [(side*(outer-.001),hinge_y,.003 if not shield else -.013),hinge], thickness*.85, frame)
        length = spec.get('temple_length',140)/1000
        control = [(0,0,0),(side*.003,-.001,-.024),(side*.006,-.003,-.075),(side*.008,-.004,-.105)]
        points = bezier(control,26)
        points += bezier([points[-1],(side*.008,-.004,-.118),(side*.006,-.017,-length),(side*.003,-.021,-length)],14)[1:]
        temple = sweep('temple_'+suffix, points, spec.get('templeRadius',max(spec['rim']*.8,1.0))/1000, frame, origin=hinge)
        temple['hingePivot'] = True
        temple['coordinateConvention'] = 'metres, Y-up, front +Z; local hinge origin'
        sphere('hinge_screw_'+suffix, (hinge[0]-side*.0015,hinge[1],hinge[2]+.0018),(.00072,.00072,.00038),silver)
        if spec.get('studs'):
            for dy in [-.001,.001]:
                sphere('front_rivet_'+suffix+str(dy),(side*(outer-.002),hinge_y+dy,.006),(.0012,.0004,.0005),silver)
        # Pad supports and pads sit behind the lens plane, independently modeled.
        px = side*(gap/2+.002)
        sweep('pad_arm_'+suffix,[(px,cy-.002,.002),(px-side*.002,cy-.005,-.004)],.00065,silver)
        sphere('nose_pad_'+suffix,(px-side*.002,cy-.007,-.004),(.0016,.004,.0016),pad)
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def studio():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 720
    scene.render.resolution_y = 480
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = True
    scene.render.image_settings.color_mode = 'RGBA'
    scene.world.color = (.8,.8,.8)
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.82,.84,.88,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = .45
    scene.view_settings.view_transform = 'AgX'
    for name, pos, energy, size in [('Key softbox',(-.16,.25,.30),2.4,.24),('Rim softbox',(.20,.08,-.04),1.6,.18),('Front strip',(-.1,.02,.32),.6,.10)]:
        data = bpy.data.lights.new(name,'AREA')
        data.energy, data.shape, data.size = energy,'DISK',size
        obj = bpy.data.objects.new(name,data)
        scene.collection.objects.link(obj)
        obj.location = xyz(pos)
        obj.rotation_euler = (Vector(xyz((0,-.02,-.04)))-obj.location).to_track_quat('-Z','Y').to_euler()
    camera_data = bpy.data.cameras.new('Product camera')
    camera = bpy.data.objects.new('Product camera',camera_data)
    scene.collection.objects.link(camera)
    camera.location = xyz((.105,.076,.295))
    camera.rotation_euler = (Vector(xyz((0,-.014,-.037)))-camera.location).to_track_quat('-Z','Y').to_euler()
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = .245
    scene.camera = camera


def clear():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for materials in list(bpy.data.materials):
        if not materials.users:
            bpy.data.materials.remove(materials)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--only')
    parser.add_argument('--skip-previews', action='store_true')
    opts = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    catalog_path = ASSETS/'catalog.json'
    specs = json.loads(catalog_path.read_text())['models']
    records = []
    original = json.loads((PUBLIC/'models.json').read_text())['models']
    original = [m for m in original if m.get('collection') != 'tim-video']
    listed = []
    for spec in specs:
        listed.append({key:spec[key] for key in ['id','label','color','material','shape','styles','palette','temple_length']})
        listed[-1]['reference_times'] = spec.get('reference_times', [spec['time']])
        listed[-1].update(file=spec['id']+'-v1.glb',lens_width=spec['width'],bridge_width=spec['gap'],collection='tim-video',reference={'url':SOURCE,'time':spec['time'],'label':spec['referenceLabel']},preview='previews/'+spec['id']+'-v1.png',description=spec['description'])
        if opts.only and opts.only != spec['id']:
            continue
        started = time.time()
        clear()
        objects = build(spec)
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        glb = PUBLIC/(spec['id']+'-v1.glb')
        bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_yup=True,export_extras=True,export_cameras=False,export_lights=False,export_animations=False,export_materials='EXPORT')
        studio()
        blend = ASSETS/(spec['id']+'.blend')
        bpy.ops.wm.save_as_mainfile(filepath=str(blend))
        preview = PUBLIC/'previews'/(spec['id']+'-v1.png')
        if not opts.skip_previews:
            bpy.context.scene.render.filepath = str(preview)
            bpy.ops.render.render(write_still=True)
        records.append({'id':spec['id'],'input':spec,'glb':str(glb.relative_to(ROOT)),'glbBytes':glb.stat().st_size,'glbSHA256':digest(glb),'blend':str(blend.relative_to(ROOT)),'preview':str(preview.relative_to(ROOT)) if preview.exists() else None,'meshCount':len(objects),'seconds':round(time.time()-started,2)})
        print('MODEL_COMPLETE '+json.dumps(records[-1],ensure_ascii=False),flush=True)
    if not opts.only:
        for item in original:
            clear()
            bpy.ops.import_scene.gltf(filepath=str(PUBLIC/item['file']))
            studio()
            preview = PUBLIC/'previews'/(item['id']+'.png')
            bpy.context.scene.render.filepath = str(preview)
            if not opts.skip_previews:
                bpy.ops.render.render(write_still=True)
            item['preview'] = 'previews/'+item['id']+'.png'
        (PUBLIC/'models.json').write_text(json.dumps({'models':original+listed},ensure_ascii=False,indent=2)+'\n')
    record_path = ASSETS/('run-'+(opts.only or 'all')+'.json')
    record_path.write_text(json.dumps({'blenderVersion':bpy.app.version_string,'scriptSHA256':digest(Path(__file__)),'inputSHA256':digest(catalog_path),'generated':records},ensure_ascii=False,indent=2)+'\n')


if __name__ == '__main__':
    main()
